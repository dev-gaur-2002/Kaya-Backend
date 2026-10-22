import { db } from '../lib/supabase.js'
import { groq } from '../lib/groq.js'
import { getConfig, type LlmSettings } from './config.js'

export type Profile = {
  id: string
  dob: string | null
  sex: string | null
  height_cm: number | null
  conditions: string[]
  medications: { name: string; purpose?: string; timing?: string }[]
  constraints: Record<string, boolean>
  goals: string[]
  onboarding_answers: Record<string, unknown>
  derived: { summary?: string } | null
  onboarded_at: string | null
}

export type Vital = {
  kind: string
  value: number
  unit: string
  measured_at: string
  source: string
  confirmed: boolean
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await db.from('profiles').select('*').eq('id', userId).single()
  if (error) throw new Error(`profile: ${error.message}`)
  return data as Profile
}

function age(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  return Math.floor((Date.now() - d.getTime()) / 31_557_600_000)
}

/**
 * Renders the UP as compact markdown rather than JSON — cheaper in tokens and
 * models follow prose constraints more reliably than nested objects.
 *
 * Stale vitals are labelled, never silently presented as current. A BP from six
 * months ago must not be reasoned about as if it were this morning.
 */
export function renderUP(
  profile: Profile,
  vitals: Vital[],
  adherence: { goal_code: string; done: number; of: number }[],
  staleDays: number,
): string {
  const lines: string[] = ['# User profile']

  const who = [
    age(profile.dob) != null ? `${age(profile.dob)} years old` : null,
    profile.sex && profile.sex !== 'na' ? profile.sex : null,
    profile.height_cm ? `${profile.height_cm} cm` : null,
  ].filter(Boolean)
  if (who.length) lines.push(who.join(', '))

  if (profile.derived?.summary) lines.push('', profile.derived.summary)

  lines.push('', '## Conditions')
  lines.push(profile.conditions.length ? profile.conditions.join(', ') : 'None reported')

  lines.push('', '## Medications')
  if (profile.medications.length) {
    for (const m of profile.medications) {
      lines.push(`- ${[m.name, m.purpose, m.timing].filter(Boolean).join(' — ')}`)
    }
  } else {
    lines.push('None reported')
  }

  const active = Object.entries(profile.constraints).filter(([, v]) => v)
  if (active.length) {
    lines.push('', '## Constraints — these override any general advice')
    for (const [k] of active) lines.push(`- ${k}`)
  }

  if (vitals.length) {
    lines.push('', '## Recent readings')
    const cutoff = Date.now() - staleDays * 86_400_000
    for (const v of vitals) {
      const when = new Date(v.measured_at)
      const stale = when.getTime() < cutoff
      const date = when.toISOString().slice(0, 10)
      lines.push(
        `- ${v.kind}: ${v.value} ${v.unit} (${date}${stale ? ', STALE — do not treat as current' : ''})`,
      )
    }
  }

  if (adherence.length) {
    lines.push('', '## Goals, last 7 days')
    for (const a of adherence) lines.push(`- ${a.goal_code}: ${a.done}/${a.of} days`)
  }

  return lines.join('\n')
}

/** Everything the prompt needs about this user, in one round trip set. */
export async function loadContext(userId: string) {
  const app = await getConfig<{ vital_stale_days: number }>('app.settings')
  const profile = await getProfile(userId)

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: vitals } = await db
    .from('vitals')
    .select('kind,value,unit,measured_at,source,confirmed')
    .eq('user_id', userId)
    .eq('confirmed', true) // unconfirmed PDF extractions never reach the prompt
    .gte('measured_at', since)
    .order('measured_at', { ascending: false })
    .limit(20)

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const { data: logs } = await db
    .from('goal_logs')
    .select('goal_code,completed')
    .eq('user_id', userId)
    .gte('log_date', weekAgo)

  const byGoal = new Map<string, { done: number; of: number }>()
  for (const code of profile.goals) byGoal.set(code, { done: 0, of: 7 })
  for (const l of logs ?? []) {
    const e = byGoal.get(l.goal_code)
    if (e && l.completed) e.done++
  }
  const adherence = [...byGoal].map(([goal_code, v]) => ({ goal_code, ...v }))

  return { profile, vitals: (vitals ?? []) as Vital[], adherence, staleDays: app.vital_stale_days }
}

/**
 * Turns raw onboarding answers into the UP. Answers are kept on the profile, so
 * this can be re-run over them whenever the synthesis prompt changes.
 */
export async function synthesize(userId: string, answers: Record<string, unknown>) {
  const [system, llm] = await Promise.all([
    getConfig<string>('prompt.onboarding_synthesis'),
    getConfig<LlmSettings>('llm.settings'),
  ])

  const res = await groq.chat.completions.create({
    model: llm.model,
    temperature: 0.1, // extraction, not conversation
    reasoning_effort: 'low', // parsing answers into fields does not need deliberation
    max_tokens: llm.max_tokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(answers, null, 2) },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? '{}'
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('onboarding synthesis returned invalid JSON')
  }

  // The answers are the source of truth for conditions and goals — the model
  // only summarises. Taking its word for which conditions the user has would let
  // a hallucination silently change every future piece of advice.
  const conditions = Array.isArray(answers.conditions)
    ? (answers.conditions as string[]).filter((c) => c !== 'none')
    : []
  const goals = Array.isArray(answers.goals) ? (answers.goals as string[]) : []

  const constraints = {
    ...(typeof parsed.constraints === 'object' ? parsed.constraints : {}),
    ckd: conditions.includes('ckd'),
    pregnant: answers.pregnant === true,
    ed_history: answers.ed_history === true,
    exercise_restricted: answers.cardiac_history === true || conditions.includes('cardiac'),
  }

  const { error } = await db
    .from('profiles')
    .update({
      dob: answers.dob ?? null,
      sex: answers.sex ?? null,
      height_cm: answers.height_cm ?? null,
      conditions,
      goals,
      medications: Array.isArray(parsed.medications) ? parsed.medications : [],
      constraints,
      derived: { summary: typeof parsed.summary === 'string' ? parsed.summary : '' },
      onboarding_answers: answers,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) throw new Error(`profile update: ${error.message}`)
  return getProfile(userId)
}

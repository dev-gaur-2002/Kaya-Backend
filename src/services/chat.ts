import { db } from '../lib/supabase.js'
import { groq } from '../lib/groq.js'
import { getConfig, type LlmSettings } from './config.js'
import { buildSystemPrompt } from './prompt.js'
import { triage, type VitalReading } from './safety.js'
import { extractReadings, type Extracted } from './readings.js'
import { applyGoalChanges, type GoalChange } from './goals.js'
import type { SafetyRule } from './config.schemas.js'

export type LoggedVital = { kind: string; value: number; unit: string }

export type ChatResult = {
  reply: string
  safetyRuleKey: string | null
  conversationId: string
  logged: LoggedVital[]
  /** Set when this message changed which goals they track, so the app can
      re-render the profile without the user going to look for a refresh. */
  goals: GoalChange | null
}

// Readings typed into the chat are the only way vitals get logged, so they are
// stored here before triage runs — a number nobody saved is a number no safety
// rule can fire on and the next turn's prompt will not see.
async function storeReadings(userId: string, found: Extracted[]): Promise<LoggedVital[]> {
  if (!found.length) return []
  const now = new Date().toISOString()
  const { error } = await db.from('vitals').insert(
    found.map((r) => ({
      user_id: userId,
      kind: r.kind,
      value: r.value,
      unit: r.unit,
      raw_value: r.rawValue,
      raw_unit: r.rawUnit,
      measured_at: now,
      source: 'self_report' as const,
      confirmed: true, // they told us themselves; nothing to second-guess
    })),
  )
  if (error) throw new Error(`vitals: ${error.message}`)
  return found.map(({ kind, value, unit }) => ({ kind, value, unit }))
}

async function ensureConversation(userId: string, conversationId?: string): Promise<string> {
  if (conversationId) {
    const { data } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId) // ownership check — never trust the id alone
      .maybeSingle()
    if (data) return data.id
  }
  const { data, error } = await db
    .from('conversations')
    .insert({ user_id: userId })
    .select('id')
    .single()
  if (error) throw new Error(`conversation: ${error.message}`)
  return data.id
}

export async function sendMessage(
  userId: string,
  message: string,
  justLogged: VitalReading[] = [],
  conversationId?: string,
): Promise<ChatResult> {
  const convId = await ensureConversation(userId, conversationId)
  const rules = await getConfig<SafetyRule[]>('safety.rules')

  await db.from('messages').insert({ conversation_id: convId, role: 'user', content: message })

  const logged = await storeReadings(userId, extractReadings(message))
  const readings: VitalReading[] = [...justLogged, ...logged.map((v) => ({ kind: v.kind, value: v.value }))]

  // Deterministic triage runs first and wins. The model is never given the
  // chance to talk someone out of calling an ambulance.
  const fired = triage(message, readings, rules)
  if (fired) {
    await db.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: fired.response_copy,
      safety_rule_key: fired.key,
    })
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convId)
    return { reply: fired.response_copy, safetyRuleKey: fired.key, conversationId: convId, logged, goals: null }
  }

  // Before the prompt is built, so the UP it renders already has the new goals
  // and the reply cannot talk about the old set. Safety triage ran first and
  // would have returned by now — a crisis message is never a goal message.
  const goals = await applyGoalChanges(userId, message)

  const [system, llm, app] = await Promise.all([
    buildSystemPrompt(userId, message, readings, rules, goals),
    getConfig<LlmSettings>('llm.settings'),
    getConfig<{ history_turns: number }>('app.settings'),
  ])

  const { data: history } = await db
    .from('messages')
    .select('role,content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(app.history_turns)

  const turns = (history ?? []).reverse().map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const res = await groq.chat.completions.create({
    model: llm.model,
    temperature: llm.temperature,
    max_tokens: llm.max_tokens,
    reasoning_effort: llm.reasoning_effort,
    messages: [{ role: 'system', content: system }, ...turns],
  })

  const reply = res.choices[0]?.message?.content?.trim() || 'Sorry, I could not answer that.'

  await db.from('messages').insert({
    conversation_id: convId,
    role: 'assistant',
    content: reply,
    tokens: res.usage?.total_tokens ?? null,
  })
  await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convId)

  return { reply, safetyRuleKey: null, conversationId: convId, logged, goals }
}

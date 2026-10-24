import { db } from '../lib/supabase.js'
import { groq } from '../lib/groq.js'
import { getConfig, type LlmSettings } from './config.js'
import { getProfile } from './profile.js'
import type { GoalTemplate } from './config.schemas.js'

export type GoalChange = { added: string[]; removed: string[]; goals: string[] }

/**
 * Gate before the structured pass. Deciding what someone meant by "drop the
 * water one" needs a model, but a model call on every chat turn is latency
 * everyone pays for so that a few messages work. Unlike readings.ts this gate
 * only has to be generous — a false positive costs one cheap call, and the
 * model is the thing that says no.
 */
const INTENT = /\b(goals?|track(?:ing|er)?|monitor(?:ing)?|start|stop|quit|drop|remove|add|swap|focus)\b/i

/**
 * Applies add/remove, keeping it idempotent and bounded by the catalogue —
 * the model picks from codes, it never invents one, and asking twice for the
 * same goal is a no-op rather than a duplicate.
 */
export function mergeGoals(
  current: string[],
  add: unknown,
  remove: unknown,
  known: Set<string>,
): GoalChange | null {
  const pick = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter((c): c is string => typeof c === 'string' && known.has(c))

  const removed = pick(remove).filter((c) => current.includes(c))
  const added = pick(add).filter((c) => !current.includes(c))
  if (!added.length && !removed.length) return null

  const goals = [...current.filter((c) => !removed.includes(c)), ...added]
  return { added, removed, goals }
}

/**
 * Changes the user's goals from what they said in chat. Returns null when the
 * message was not about goals, or asked for nothing that is not already true.
 *
 * Failure is non-fatal on purpose: a dead goal pass must never cost someone
 * their reply. They will have to tap it on the profile screen instead.
 */
export async function applyGoalChanges(userId: string, message: string): Promise<GoalChange | null> {
  if (!INTENT.test(message)) return null
  try {
    const [catalogue, system, llm, profile] = await Promise.all([
      getConfig<GoalTemplate[]>('goals.catalogue'),
      getConfig<string>('prompt.goal_intent'),
      getConfig<LlmSettings>('llm.settings'),
      getProfile(userId),
    ])

    const res = await groq.chat.completions.create({
      model: llm.model,
      temperature: 0,
      reasoning_effort: 'low', // matching a sentence to a code, not deliberating
      max_tokens: llm.max_tokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({
            catalogue: catalogue.map((g) => ({ code: g.code, title: g.title })),
            currently_tracking: profile.goals,
            message,
          }),
        },
      ],
    })

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')
    const change = mergeGoals(
      profile.goals,
      parsed.add,
      parsed.remove,
      new Set(catalogue.map((g) => g.code)),
    )
    if (!change) return null

    const { error } = await db.from('profiles').update({ goals: change.goals }).eq('id', userId)
    if (error) throw new Error(error.message)
    return change
  } catch (e) {
    console.error('applyGoalChanges:', (e as Error).message)
    return null
  }
}

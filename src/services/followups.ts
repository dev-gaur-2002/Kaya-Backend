import { db } from '../lib/supabase.js'
import { groq } from '../lib/groq.js'
import { getConfig, type LlmSettings } from './config.js'
import { loadContext, renderUP } from './profile.js'

/**
 * Follow-ups are in-app in v1: the app asks on open, and a due one seeds the
 * chat with an assistant-first message. Adding push later makes this a delivery
 * transport over the same table — no redesign.
 */
export async function dueFollowUp(userId: string) {
  const { data } = await db
    .from('follow_ups')
    .select('id,opener,reason,conversation_id')
    .eq('user_id', userId)
    .eq('status', 'queued')
    .lte('due_at', new Date().toISOString())
    .order('due_at')
    .limit(1)
    .maybeSingle()
  return data
}

export async function markDelivered(userId: string, id: string) {
  await db.from('follow_ups').update({ status: 'delivered' }).eq('id', id).eq('user_id', userId)
}

export type QueueOpts = {
  /** 'cadence' is the periodic nudge; anything else is about a specific event. */
  reason?: string
  /** Appended to the generator's input so the opener is about that event. */
  context?: string
  conversationId?: string
}

/** Queues a follow-up. The cadence one is idempotent per window; event ones are not. */
export async function queueNext(userId: string, opts: QueueOpts = {}) {
  const reason = opts.reason ?? 'cadence'
  const app = await getConfig<{
    followup_cadence_hours: number
    meal_followup_hours: number
  }>('app.settings')

  // Only the periodic nudge is one-at-a-time. An event follow-up is about a
  // thing that just happened and is worthless if a queued cadence one blocks it.
  if (reason === 'cadence') {
    const { count } = await db
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'queued')
    if ((count ?? 0) > 0) return null
  }

  const [system, llm, ctx] = await Promise.all([
    getConfig<string>('prompt.followup_generator'),
    getConfig<LlmSettings>('llm.settings'),
    loadContext(userId),
  ])

  const res = await groq.chat.completions.create({
    model: llm.model,
    temperature: llm.temperature,
    max_tokens: 600, // reasoning tokens share this budget with the opener
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          renderUP(ctx.profile, ctx.vitals, ctx.adherence, ctx.staleDays),
          opts.context ? `\n# What just happened\n${opts.context}` : '',
        ].join(''),
      },
    ],
  })

  const opener = res.choices[0]?.message?.content?.trim()
  if (!opener) return null

  const hours = reason === 'meal' ? app.meal_followup_hours : app.followup_cadence_hours
  const dueAt = new Date(Date.now() + hours * 3_600_000).toISOString()
  const { data } = await db
    .from('follow_ups')
    .insert({
      user_id: userId,
      reason,
      opener,
      due_at: dueAt,
      conversation_id: opts.conversationId ?? null,
    })
    .select('id,opener,due_at')
    .single()
  return data
}

import { db } from '../lib/supabase.js'
import { groq } from '../lib/groq.js'
import { getConfig } from './config.js'
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

/** Queues the next follow-up if none is pending. Idempotent per cadence window. */
export async function queueNext(userId: string) {
  const app = await getConfig<{ followup_cadence_hours: number }>('app.settings')

  const { count } = await db
    .from('follow_ups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'queued')
  if ((count ?? 0) > 0) return null

  const [system, llm, ctx] = await Promise.all([
    getConfig<string>('prompt.followup_generator'),
    getConfig<{ model: string; temperature: number }>('llm.settings'),
    loadContext(userId),
  ])

  const res = await groq.chat.completions.create({
    model: llm.model,
    temperature: llm.temperature,
    max_tokens: 200,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: renderUP(ctx.profile, ctx.vitals, ctx.adherence, ctx.staleDays),
      },
    ],
  })

  const opener = res.choices[0]?.message?.content?.trim()
  if (!opener) return null

  const dueAt = new Date(Date.now() + app.followup_cadence_hours * 3_600_000).toISOString()
  const { data } = await db
    .from('follow_ups')
    .insert({ user_id: userId, reason: 'cadence', opener, due_at: dueAt })
    .select('id,opener,due_at')
    .single()
  return data
}

import { db } from '../lib/supabase.js'
import { groq } from '../lib/groq.js'
import { getConfig } from './config.js'
import { buildSystemPrompt } from './prompt.js'
import { triage, type VitalReading } from './safety.js'
import type { SafetyRule } from './config.schemas.js'

export type ChatResult = { reply: string; safetyRuleKey: string | null; conversationId: string }

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

  // Deterministic triage runs first and wins. The model is never given the
  // chance to talk someone out of calling an ambulance.
  const fired = triage(message, justLogged, rules)
  if (fired) {
    await db.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: fired.response_copy,
      safety_rule_key: fired.key,
    })
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convId)
    return { reply: fired.response_copy, safetyRuleKey: fired.key, conversationId: convId }
  }

  const [system, llm, app] = await Promise.all([
    buildSystemPrompt(userId, message, justLogged, rules),
    getConfig<{ model: string; temperature: number; max_tokens: number }>('llm.settings'),
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

  return { reply, safetyRuleKey: null, conversationId: convId }
}

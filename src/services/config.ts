import { db } from '../lib/supabase.js'
import { schemaFor, type ConditionPack } from './config.schemas.js'

/**
 * All app config lives in one table: configs(key text PK, value jsonb).
 * Collapsing six typed tables into one jsonb column means Postgres no longer
 * catches a malformed config — so the schemas in config.schemas.ts are the only
 * thing standing between a stray comma in Supabase Studio and a dead onboarding
 * flow. Every key is validated on load and failure names the key.
 */

type Entry = { at: number; value: unknown }
const cache = new Map<string, Entry>()
// ponytail: 60s TTL instead of cache invalidation. Studio edits show within a
// minute, which is the whole point of config-in-DB. Add a bust endpoint if that bites.
const TTL_MS = 60_000

export function clearConfigCache(): void {
  cache.clear()
}

export async function getConfig<T>(key: string): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T

  const { data, error } = await db.from('configs').select('value').eq('key', key).maybeSingle()
  if (error) throw new Error(`config: cannot read key "${key}" — ${error.message}`)
  if (!data) throw new Error(`config: missing key "${key}" — is the seed applied?`)

  const parsed = schemaFor(key).safeParse(data.value)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`config: key "${key}" failed validation — ${detail}`)
  }

  cache.set(key, { at: Date.now(), value: parsed.data })
  return parsed.data as T
}

/** Condition packs for the conditions this user actually has. Missing packs are skipped. */
export async function getPacks(conditionCodes: string[]): Promise<ConditionPack[]> {
  const packs: ConditionPack[] = []
  for (const code of conditionCodes) {
    try {
      packs.push(await getConfig<ConditionPack>(`packs.${code}`))
    } catch {
      // A condition with no pack is normal — the UP still carries it into the prompt.
    }
  }
  return packs
}

export * from './config.schemas.js'

export type LlmSettings = {
  model: string
  temperature: number
  max_tokens: number
  reasoning_effort: 'low' | 'medium' | 'high'
  vision_model: string
}

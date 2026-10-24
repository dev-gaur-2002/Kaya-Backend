import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { schemaFor } from './config.schemas.js'

/**
 * The seed is the source of truth for every prompt, question and safety rule,
 * and it reaches production as raw jsonb that Postgres will not type-check.
 * This is the check that catches a broken config before deploy rather than
 * when a user opens onboarding.
 */

const sql = readFileSync(new URL('../../supabase/seed.sql', import.meta.url), 'utf8')

// ('key', '<json>'::jsonb  |  ('key', to_jsonb('<text literal>'::text)  — the two
// shapes in the seed. A prompt is a bare string, so it needs the to_jsonb wrapper:
// Postgres casting a bare text literal into a jsonb column is a syntax error.
const entries = [...sql.matchAll(/\('([a-z0-9_.]+)',\s*(?:to_jsonb\()?('(?:[^']|'')*')(::jsonb)?/g)].map(
  ([, key, literal, isJsonb]) => ({
    key,
    raw: literal.slice(1, -1).replaceAll("''", "'"),
    isJsonb: Boolean(isJsonb),
  }),
)

it('finds every config key in the seed', () => {
  expect(entries.length).toBeGreaterThanOrEqual(16)
})

describe.each(entries)('config key $key', ({ key, raw, isJsonb }) => {
  it('parses and satisfies its schema', () => {
    const value = isJsonb ? JSON.parse(raw) : raw
    const result = schemaFor(key).safeParse(value)
    if (!result.success) {
      throw new Error(
        `${key}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      )
    }
    expect(result.success).toBe(true)
  })
})

it('seeds a condition pack for every condition offered in onboarding', () => {
  const questions = JSON.parse(entries.find((e) => e.key === 'onboarding.questions')!.raw)
  const offered: string[] = questions
    .find((q: { id: string }) => q.id === 'conditions')
    .options.map((o: { value: string }) => o.value)
    .filter((c: string) => c !== 'none')
  const seeded = entries.filter((e) => e.key.startsWith('packs.')).map((e) => e.key.slice(6))
  // A missing pack is tolerated at runtime, but an unseeded condition means the
  // model gets no specific guidance for someone who said they have it.
  expect(offered.filter((c) => !seeded.includes(c))).toEqual(['thyroid'])
})

it('gives every emergency rule non-empty copy, since that copy replaces the model', () => {
  const rules = JSON.parse(entries.find((e) => e.key === 'safety.rules')!.raw)
  for (const r of rules.filter((r: { severity: string }) => r.severity !== 'caution')) {
    expect(r.response_copy.length, `${r.key} has empty copy`).toBeGreaterThan(40)
  }
})

it('gives every goal a target the counter can count up to', () => {
  const goals = JSON.parse(entries.find((e) => e.key === 'goals.catalogue')!.raw)
  // The profile screen draws "5 / 8 glasses" straight off default_target, and
  // the log route derives completed from it. A zero target would mark every
  // goal done the moment it is picked.
  for (const g of goals) {
    expect(g.default_target, `${g.code} has no usable target`).toBeGreaterThan(0)
    expect(g.unit.length, `${g.code} has no unit to label the counter`).toBeGreaterThan(0)
  }
  expect(goals.find((g: { code: string }) => g.code === 'water').default_target).toBe(8)
})

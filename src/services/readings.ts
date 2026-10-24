import { CANONICAL, normalize } from './units.js'

/**
 * Pulls readings out of what someone types in chat ("bp 140/90", "sugar was
 * 110 this morning", "72.5 kg"). Deterministic on purpose: these numbers feed
 * safety triage, and a regex that misses is better than a model that invents.
 * Anything implausible is dropped by normalize() rather than stored as a guess.
 */
export type Extracted = { kind: string; value: number; unit: string; rawValue: number; rawUnit: string }

const NUM = String.raw`\d+(?:[.,]\d+)?`
const UNIT = String.raw`(?:mg\s*\/\s*dl|mmol\s*\/\s*l|mmol\s*\/\s*mol|mmhg|kgs?|lbs?|pounds?|stone|st|%|steps)`

// "bp 140/90", "140 / 90". The pair is handled first and cut out of the text so
// its numbers can't be mistaken for a labelled single reading further down.
const BP = new RegExp(String.raw`(?:\bbp\b|blood\s*pressure)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b`, 'gi')

const ALIASES: Record<string, string> = {
  fasting_glucose: String.raw`(?:fasting\s+)?(?:blood\s+)?(?:glucose|sugar|fbs|fbg)`,
  hba1c: String.raw`hba1c|a1c`,
  ldl: String.raw`ldl`,
  hdl: String.raw`hdl`,
  total_cholesterol: String.raw`(?:total\s+)?cholesterol`,
  triglycerides: String.raw`triglycerides|trigs`,
  weight: String.raw`weigh(?:t|ed|s)?`,
  steps: String.raw`steps|walked`,
  systolic: String.raw`systolic`,
  diastolic: String.raw`diastolic`,
}

// A number may sit on either side of its label ("sugar 110", "walked 8000 steps").
// The gap stays short so an unrelated number elsewhere in the sentence is not
// swept up as a reading.
const GAP = String.raw`[^\d\n]{0,14}`

function push(out: Extracted[], kind: string, raw: string, rawUnit: string) {
  const rawValue = Number(raw.replace(',', '.'))
  const norm = normalize(kind, rawValue, rawUnit || CANONICAL[kind])
  if (norm) out.push({ kind, value: norm.value, unit: norm.unit, rawValue, rawUnit: rawUnit || CANONICAL[kind] })
}

export function extractReadings(message: string): Extracted[] {
  const out: Extracted[] = []

  const rest = message.replace(BP, (m, sys: string, dia: string) => {
    push(out, 'systolic', sys, 'mmHg')
    push(out, 'diastolic', dia, 'mmHg')
    return ' '
  })

  for (const [kind, alias] of Object.entries(ALIASES)) {
    const after = new RegExp(String.raw`(?:${alias})${GAP}(${NUM})\s*(${UNIT})?`, 'i').exec(rest)
    const before = new RegExp(String.raw`(${NUM})\s*(${UNIT})?${GAP}(?:${alias})`, 'i').exec(rest)
    const hit = after ?? before
    if (hit && !out.some((r) => r.kind === kind)) push(out, kind, hit[1], (hit[2] ?? '').trim())
  }

  return out
}

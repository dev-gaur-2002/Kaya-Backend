/**
 * Unit normalization for vitals. This matters more than it looks: glucose in
 * mmol/L read as mg/dL is an 18x error, and lab PDFs use both depending on country.
 * Everything is stored in the canonical unit; the value as printed on the document
 * is kept alongside it so a user can check the conversion.
 */

export const CANONICAL: Record<string, string> = {
  systolic: 'mmHg',
  diastolic: 'mmHg',
  fasting_glucose: 'mg/dL',
  hba1c: '%',
  ldl: 'mg/dL',
  hdl: 'mg/dL',
  total_cholesterol: 'mg/dL',
  triglycerides: 'mg/dL',
  weight: 'kg',
  steps: 'steps',
}

// Rejects nonsense before it reaches the UP. Ranges are deliberately wide —
// this catches unit errors and OCR garbage, not clinically unusual values.
const PLAUSIBLE: Record<string, [number, number]> = {
  systolic: [50, 300],
  diastolic: [20, 200],
  fasting_glucose: [20, 800],
  hba1c: [3, 20],
  ldl: [10, 600],
  hdl: [5, 200],
  total_cholesterol: [30, 900],
  triglycerides: [10, 2000],
  weight: [20, 400],
  steps: [0, 200_000],
}

const MMOL_TO_MGDL_GLUCOSE = 18.0182
const MMOL_TO_MGDL_CHOL = 38.67
const LB_TO_KG = 0.453592
const STONE_TO_KG = 6.35029

function norm(unit: string): string {
  return unit.toLowerCase().replace(/\s+/g, '').replace('µ', 'u')
}

export type Normalized = { value: number; unit: string }

/**
 * Convert a reading to its canonical unit. Returns null when the unit is not
 * recognised for that kind, or when the result is implausible — callers must
 * treat null as "ask the user", never as zero.
 */
export function normalize(kind: string, value: number, unit: string): Normalized | null {
  if (!Number.isFinite(value)) return null
  const canonical = CANONICAL[kind]
  if (!canonical) return null

  const u = norm(unit)
  let out = value

  if (kind === 'fasting_glucose') {
    if (u === 'mmol/l' || u === 'mmoll') out = value * MMOL_TO_MGDL_GLUCOSE
    else if (u !== 'mg/dl' && u !== 'mgdl') return null
  } else if (['ldl', 'hdl', 'total_cholesterol', 'triglycerides'].includes(kind)) {
    if (u === 'mmol/l' || u === 'mmoll') out = value * MMOL_TO_MGDL_CHOL
    else if (u !== 'mg/dl' && u !== 'mgdl') return null
  } else if (kind === 'hba1c') {
    // IFCC mmol/mol -> DCCT %
    if (u === 'mmol/mol' || u === 'mmolmol') out = value / 10.929 + 2.15
    else if (u !== '%' && u !== 'percent') return null
  } else if (kind === 'weight') {
    if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') out = value * LB_TO_KG
    else if (u === 'st' || u === 'stone') out = value * STONE_TO_KG
    else if (u !== 'kg' && u !== 'kgs') return null
  } else if (kind === 'systolic' || kind === 'diastolic') {
    if (u !== 'mmhg' && u !== '') return null
  }

  out = Math.round(out * 100) / 100
  const [lo, hi] = PLAUSIBLE[kind]
  if (out < lo || out > hi) return null

  return { value: out, unit: canonical }
}

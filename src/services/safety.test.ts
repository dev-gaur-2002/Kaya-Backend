import { describe, it, expect } from 'vitest'
import { triage, cautions } from './safety.js'
import type { SafetyRule } from './config.schemas.js'

const rules: SafetyRule[] = [
  { key: 'bp_crisis', kind: 'threshold', vital_kind: 'systolic', operator: 'gte', threshold: 180,
    severity: 'emergency', response_copy: 'CRISIS_COPY' },
  { key: 'bp_crisis_dia', kind: 'threshold', vital_kind: 'diastolic', operator: 'gte', threshold: 120,
    severity: 'emergency', response_copy: 'CRISIS_COPY' },
  { key: 'hypo', kind: 'threshold', vital_kind: 'fasting_glucose', operator: 'lt', threshold: 70,
    severity: 'emergency', response_copy: 'HYPO_COPY' },
  { key: 'hyper', kind: 'threshold', vital_kind: 'fasting_glucose', operator: 'gt', threshold: 300,
    severity: 'urgent', response_copy: 'HYPER_COPY' },
  { key: 'cardiac', kind: 'phrase', phrases: ['chest pain', 'slurred speech', 'one-sided weakness'],
    severity: 'emergency', response_copy: 'EMERGENCY_COPY' },
  { key: 'bp_high', kind: 'threshold', vital_kind: 'systolic', operator: 'gte', threshold: 140,
    severity: 'caution', response_copy: '' },
]

describe('triage thresholds', () => {
  it('fires at the hypertensive-crisis boundary', () => {
    expect(triage('', [{ kind: 'systolic', value: 180 }], rules)?.key).toBe('bp_crisis')
  })

  it('does not fire one below the boundary', () => {
    expect(triage('', [{ kind: 'systolic', value: 179 }], rules)?.key).not.toBe('bp_crisis')
  })

  it('fires on diastolic alone', () => {
    expect(triage('', [{ kind: 'diastolic', value: 125 }], rules)?.key).toBe('bp_crisis_dia')
  })

  it('fires on hypoglycemia below 70', () => {
    expect(triage('', [{ kind: 'fasting_glucose', value: 69 }], rules)?.key).toBe('hypo')
  })

  it('does not fire at exactly 70', () => {
    expect(triage('', [{ kind: 'fasting_glucose', value: 70 }], rules)).toBeNull()
  })

  it('fires on hyperglycemia above 300', () => {
    expect(triage('', [{ kind: 'fasting_glucose', value: 301 }], rules)?.key).toBe('hyper')
  })
})

describe('triage phrases', () => {
  it('matches a red-flag symptom anywhere in the message', () => {
    expect(triage('since this morning I have chest pain', [], rules)?.key).toBe('cardiac')
  })

  it('is case insensitive', () => {
    expect(triage('CHEST PAIN', [], rules)?.key).toBe('cardiac')
  })

  it('returns null on an ordinary message', () => {
    expect(triage('what should I eat for lunch?', [], rules)).toBeNull()
  })
})

describe('triage precedence', () => {
  it('prefers emergency over caution when both match', () => {
    // 185 systolic matches both bp_crisis (emergency) and bp_high (caution).
    expect(triage('', [{ kind: 'systolic', value: 185 }], rules)?.key).toBe('bp_crisis')
  })

  it('returns the canned copy, which is what the user must see instead of model output', () => {
    expect(triage('', [{ kind: 'systolic', value: 185 }], rules)?.response_copy).toBe('CRISIS_COPY')
  })
})

describe('caution rules', () => {
  it('does not escalate — 145 systolic must not hijack the reply', () => {
    expect(triage('', [{ kind: 'systolic', value: 145 }], rules)).toBeNull()
  })

  it('is surfaced separately so the model can answer with the number in mind', () => {
    expect(cautions('', [{ kind: 'systolic', value: 145 }], rules).map((r) => r.key)).toEqual([
      'bp_high',
    ])
  })

  it('yields nothing when the reading is normal', () => {
    expect(cautions('', [{ kind: 'systolic', value: 118 }], rules)).toEqual([])
  })
})

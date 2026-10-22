import { describe, it, expect } from 'vitest'
import { normalize } from './units.js'

describe('glucose', () => {
  it('passes mg/dL through', () => {
    expect(normalize('fasting_glucose', 95, 'mg/dL')).toEqual({ value: 95, unit: 'mg/dL' })
  })

  it('converts mmol/L to mg/dL — the 18x error this exists to prevent', () => {
    expect(normalize('fasting_glucose', 5.5, 'mmol/L')?.value).toBeCloseTo(99.1, 1)
  })

  it('rejects an unknown unit rather than guessing', () => {
    expect(normalize('fasting_glucose', 5.5, 'bananas')).toBeNull()
  })
})

describe('hba1c', () => {
  it('passes % through', () => {
    expect(normalize('hba1c', 7.2, '%')).toEqual({ value: 7.2, unit: '%' })
  })

  it('converts IFCC mmol/mol to DCCT %', () => {
    expect(normalize('hba1c', 53, 'mmol/mol')?.value).toBeCloseTo(7.0, 1)
  })
})

describe('cholesterol', () => {
  it('converts mmol/L to mg/dL', () => {
    expect(normalize('ldl', 3.0, 'mmol/L')?.value).toBeCloseTo(116, 0)
  })
})

describe('weight', () => {
  it('converts pounds to kg', () => {
    expect(normalize('weight', 180, 'lb')?.value).toBeCloseTo(81.65, 1)
  })
})

describe('plausibility', () => {
  it('rejects a glucose that is really mmol/L mislabelled as mg/dL', () => {
    // 5.5 "mg/dL" is below the plausible floor — almost certainly an unlabelled mmol/L.
    expect(normalize('fasting_glucose', 5.5, 'mg/dL')).toBeNull()
  })

  it('rejects an impossible systolic', () => {
    expect(normalize('systolic', 1850, 'mmHg')).toBeNull()
  })

  it('rejects NaN', () => {
    expect(normalize('weight', Number.NaN, 'kg')).toBeNull()
  })

  it('rejects an unknown vital kind', () => {
    expect(normalize('vibes', 5, 'units')).toBeNull()
  })
})

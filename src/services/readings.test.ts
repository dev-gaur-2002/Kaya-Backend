import { describe, it, expect } from 'vitest'
import { extractReadings } from './readings.js'

const find = (msg: string, kind: string) => extractReadings(msg).find((r) => r.kind === kind)

describe('blood pressure', () => {
  it('reads a bare pair', () => {
    expect(find('140/90 this morning', 'systolic')?.value).toBe(140)
    expect(find('140/90 this morning', 'diastolic')?.value).toBe(90)
  })

  it('reads a labelled pair', () => {
    expect(find('my bp was 128 / 82', 'systolic')?.value).toBe(128)
  })

  it('drops a date, not a reading', () => {
    expect(extractReadings('saw the doctor on 10/10')).toEqual([])
  })
})

describe('labelled singles', () => {
  it('takes the number after the label', () => {
    expect(find('sugar 110 fasting', 'fasting_glucose')?.value).toBe(110)
  })

  it('takes the number before the label', () => {
    expect(find('walked 8000 steps today', 'steps')?.value).toBe(8000)
  })

  it('converts the stated unit', () => {
    expect(find('weight 160 lbs', 'weight')?.value).toBeCloseTo(72.57, 1)
    expect(find('fasting glucose 5.5 mmol/L', 'fasting_glucose')?.value).toBeCloseTo(99.1, 1)
  })

  it('assumes the canonical unit when none is given', () => {
    expect(find('weighed 72.5', 'weight')).toMatchObject({ value: 72.5, unit: 'kg' })
  })

  it('drops an implausible value instead of storing a guess', () => {
    // mmol/L glucose typed without its unit — 6.1 mg/dL is not a reading.
    expect(find('sugar 6.1', 'fasting_glucose')).toBeUndefined()
    // a pill count sitting next to a lab name
    expect(find('took 2 tablets for cholesterol', 'total_cholesterol')).toBeUndefined()
  })

  it('ignores an unrelated number far from any label', () => {
    expect(extractReadings('I am 45 and feeling fine')).toEqual([])
  })

  it('reads several kinds from one message', () => {
    const r = extractReadings('bp 135/85, sugar 102 mg/dL, hba1c 7.1%')
    expect(r.map((x) => x.kind).sort()).toEqual(['diastolic', 'fasting_glucose', 'hba1c', 'systolic'])
  })
})

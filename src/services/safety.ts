import type { SafetyRule } from './config.schemas.js'

export type VitalReading = { kind: string; value: number }

const SEVERITY_ORDER = { emergency: 0, urgent: 1, caution: 2 } as const

function compare(value: number, op: NonNullable<SafetyRule['operator']>, threshold: number): boolean {
  switch (op) {
    case 'gte': return value >= threshold
    case 'gt': return value > threshold
    case 'lte': return value <= threshold
    case 'lt': return value < threshold
  }
}

function matches(rule: SafetyRule, text: string, vitals: VitalReading[]): boolean {
  if (rule.kind === 'phrase') {
    return rule.phrases?.some((p) => text.includes(p.toLowerCase())) ?? false
  }
  const reading = vitals.find((v) => v.kind === rule.vital_kind)
  return reading != null && compare(reading.value, rule.operator!, rule.threshold!)
}

/**
 * Deterministic red-flag triage. Runs BEFORE the model and its answer wins:
 * when an emergency or urgent rule fires the user gets `response_copy` verbatim,
 * not model prose. A nondeterministic system must not be the only thing between
 * a user and a stroke.
 *
 * Returns the most severe escalating rule, or null. `caution` rules never
 * escalate — see cautions() — because a BP of 145 does not warrant hijacking the
 * conversation with a canned wall of text.
 */
export function triage(
  message: string,
  vitals: VitalReading[],
  rules: SafetyRule[],
): SafetyRule | null {
  const text = message.toLowerCase()
  const escalating = rules
    .filter((r) => r.severity !== 'caution')
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return escalating.find((r) => matches(r, text, vitals)) ?? null
}

/**
 * Caution-level matches. These do not replace the reply; they are injected into
 * the prompt so the model answers with the number in mind instead of ignoring it.
 */
export function cautions(
  message: string,
  vitals: VitalReading[],
  rules: SafetyRule[],
): SafetyRule[] {
  const text = message.toLowerCase()
  return rules.filter((r) => r.severity === 'caution' && matches(r, text, vitals))
}

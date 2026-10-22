import { z } from 'zod'

/**
 * Config schemas, deliberately kept free of any import with a side effect
 * (no env, no db) so the seed can be validated in CI without a database.
 * See config.ts for the loader and seed.test.ts for the check.
 */

export const questionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['single', 'multi', 'number', 'text', 'date', 'boolean']),
  prompt: z.string().min(1),
  help_text: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  validation: z
    .object({ min: z.number().optional(), max: z.number().optional(), required: z.boolean().optional() })
    .optional(),
  // Conditional display, evaluated client-side against answers already given.
  show_if: z.object({ question: z.string(), in: z.array(z.string()) }).optional(),
  // Dot-path into profiles, e.g. "conditions" or "constraints.pregnant".
  writes_to: z.string().min(1),
})

export const safetyRuleSchema = z
  .object({
    key: z.string().min(1),
    kind: z.enum(['threshold', 'phrase']),
    severity: z.enum(['emergency', 'urgent', 'caution']),
    response_copy: z.string().default(''),
    vital_kind: z.string().optional(),
    operator: z.enum(['gte', 'gt', 'lte', 'lt']).optional(),
    threshold: z.number().optional(),
    phrases: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (r) =>
      r.kind === 'phrase'
        ? !!r.phrases?.length
        : r.vital_kind != null && r.operator != null && r.threshold != null,
    { message: 'threshold rules need vital_kind+operator+threshold; phrase rules need phrases' },
  )
  // emergency and urgent rules REPLACE the model's answer, so they must have copy.
  // caution rules only annotate the prompt, so copy is optional for them.
  .refine((r) => r.severity === 'caution' || r.response_copy.length > 0, {
    message: 'emergency and urgent rules must have response_copy — it replaces the model output',
  })

export const conditionPackSchema = z.object({
  condition_code: z.string().min(1),
  guidance: z.string().min(1),
  // Advice classes this condition forbids, matched against the prompt's suppression list.
  suppress: z.array(z.string()).default([]),
})

export const goalTemplateSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  unit: z.string(),
  default_target: z.number(),
  cadence: z.enum(['daily', 'weekly']),
})

export const EXACT: Record<string, z.ZodType> = {
  'onboarding.questions': z.array(questionSchema).min(1),
  'safety.rules': z.array(safetyRuleSchema).min(1),
  'goals.catalogue': z.array(goalTemplateSchema).min(1),
  'llm.settings': z.object({
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),
    max_tokens: z.number().int().positive(),
    // gpt-oss is a reasoning model; Groq accepts low | medium | high.
    reasoning_effort: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  'app.settings': z.object({
    vital_stale_days: z.number().int().positive(),
    followup_cadence_hours: z.number().int().positive(),
    history_turns: z.number().int().positive(),
  }),
}

export function schemaFor(key: string): z.ZodType {
  if (EXACT[key]) return EXACT[key]
  if (key.startsWith('prompt.')) return z.string().min(1)
  if (key.startsWith('packs.')) return conditionPackSchema
  return z.unknown()
}

export type Question = z.infer<typeof questionSchema>
export type SafetyRule = z.infer<typeof safetyRuleSchema>
export type ConditionPack = z.infer<typeof conditionPackSchema>
export type GoalTemplate = z.infer<typeof goalTemplateSchema>

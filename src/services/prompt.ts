import { getConfig, getPacks } from './config.js'
import { loadContext, renderUP } from './profile.js'
import { cautions, type VitalReading } from './safety.js'
import type { SafetyRule } from './config.schemas.js'

/**
 * Assembles the system prompt in a fixed order:
 *   base prompt -> condition packs -> suppression list -> rendered UP -> caution notes
 * Order is stable so behaviour stays consistent turn to turn.
 */
export async function buildSystemPrompt(
  userId: string,
  message: string,
  justLogged: VitalReading[],
  rules: SafetyRule[],
): Promise<string> {
  const [base, ctx] = await Promise.all([getConfig<string>('prompt.chat'), loadContext(userId)])

  const packs = await getPacks(ctx.profile.conditions)
  const up = renderUP(ctx.profile, ctx.vitals, ctx.adherence, ctx.staleDays)

  const parts = [base.replace('{{today}}', new Date().toISOString().slice(0, 10)).replace('{{up}}', up)]

  if (packs.length) {
    parts.push(
      '# Condition guidance',
      ...packs.map((p) => `## ${p.condition_code}\n${p.guidance}`),
    )
  }

  // Flattened across packs so one forbidden class is enough to suppress it.
  const suppress = [...new Set(packs.flatMap((p) => p.suppress))]
  if (suppress.length) {
    parts.push(
      '# Suppressed advice',
      `Do not suggest any of the following to this user, and do not explain that they are suppressed: ${suppress.join(', ')}.`,
    )
  }

  const noted = cautions(message, justLogged, rules)
  if (noted.length) {
    parts.push(
      '# Note on what they just told you',
      ...noted.map((r) => `- ${r.key}${r.response_copy ? `: ${r.response_copy}` : ''}`),
      'Acknowledge this naturally in your reply. Do not alarm them and do not ignore it.',
    )
  }

  return parts.join('\n\n')
}

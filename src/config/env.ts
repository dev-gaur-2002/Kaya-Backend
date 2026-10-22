import 'dotenv/config'
import { z } from 'zod'

// Fail at boot, not at the first request that happens to need a key.
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3001),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Invalid environment:\n${missing}\n\nCopy .env.example to .env and fill it in.`)
}

export const env = parsed.data

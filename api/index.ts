// Vercel serverless entry. The repo root is the Vercel root, so this sits at
// api/ rather than under a server/ folder.
import type { IncomingMessage, ServerResponse } from 'node:http'

// config/env throws at import when a key is missing, and Vercel turns an
// import-time throw into a bare FUNCTION_INVOCATION_FAILED — the reason lives
// only in the dashboard logs. Importing lazily puts it in the response instead:
// the difference between "SUPABASE_URL: Invalid URL" and a mystery 500.
let app: ((req: IncomingMessage, res: ServerResponse) => void) | undefined
let bootError: string | undefined

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!app && !bootError) {
    try {
      app = (await import('../src/app.js')).createApp()
    } catch (err) {
      bootError = err instanceof Error ? err.message : String(err)
      console.error('[boot]', bootError)
    }
  }
  if (bootError) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify({ error: `boot failed — ${bootError}` }))
  }
  app!(req, res)
}

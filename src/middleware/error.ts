import type { Request, Response, NextFunction } from 'express'

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'not found' })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = err instanceof Error ? err.message : 'unexpected error'
  // Config failures are operator errors, not user errors — surface them loudly
  // in logs so a bad Studio edit is obvious rather than mysterious.
  console.error('[error]', message)
  const status = message.startsWith('config:') ? 500 : 400
  res.status(status).json({ error: message })
}

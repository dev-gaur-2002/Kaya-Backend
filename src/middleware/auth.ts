import type { Request, Response, NextFunction } from 'express'
import { db } from '../lib/supabase.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

/**
 * Verifies the Supabase access token and puts the user id on the request.
 *
 * This is the trust boundary: the service-role client bypasses RLS, so every
 * query downstream MUST use req.userId and never a user id from the body or query.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'missing bearer token' })

  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'invalid token' })

  req.userId = data.user.id
  next()
}

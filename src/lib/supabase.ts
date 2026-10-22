import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env.js'

// Service-role client: bypasses RLS, so every query in this codebase MUST filter
// by the user id taken from the verified JWT — never one supplied by the client.
export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

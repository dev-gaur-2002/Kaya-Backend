import { db } from '../lib/supabase.js'

/**
 * Username-only sign-in for the demo build.
 *
 * A username maps to a synthetic email and one shared password, and the account
 * is created on first sight. The password never leaves the server: this signs in
 * with it and hands the app the finished session, so the login screen is one
 * text field.
 *
 * ponytail: deliberately not real auth. Anyone who knows a username is that
 * user, which is the entire point for a demo and unacceptable for anything else.
 * Replace this route with the real sign-in flow before there is real data.
 */
export const DEMO_PASSWORD = 'kayademo123'
const DEMO_DOMAIN = 'kaya.demo'

/**
 * Usernames are the unique key, so they have to collapse to the same email
 * every time: "Asha", " asha " and "ASHA" are one account.
 *
 * Only the admin API accepts an @kaya.demo address — Supabase's public signup
 * endpoint rejects the TLD — which is the other reason accounts are made here
 * rather than in the app.
 */
export function usernameToEmail(username: string): string | null {
  const slug = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug || slug.length > 40) return null
  return `${slug}@${DEMO_DOMAIN}`
}

export async function loginAsUsername(username: string) {
  const email = usernameToEmail(username)
  if (!email) return null

  // email_confirm: true because nobody can click a link sent to kaya.demo.
  const { error: createError } = await db.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  })
  if (createError && !createError.message.toLowerCase().includes('already')) {
    throw new Error(`demo login: ${createError.message}`)
  }

  const { data, error } = await db.auth.signInWithPassword({ email, password: DEMO_PASSWORD })
  if (error || !data.session) throw new Error(`demo login: ${error?.message ?? 'no session'}`)
  return { session: data.session, username: email.split('@')[0] }
}

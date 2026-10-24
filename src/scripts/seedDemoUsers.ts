/**
 * Creates the four demo accounts and fills in their profiles.
 *
 * ponytail: demo logins, not a fixtures framework. Re-runnable — an existing
 * account gets its password reset to the documented one and its profile
 * overwritten, so the demo is always in a known state.
 *
 *   npm run seed:demo
 *
 * The passwords are in the README on purpose. Do not point this at a project
 * that holds real user data.
 */
import { db } from '../lib/supabase.js'
import { DEMO_PASSWORD, usernameToEmail } from '../services/demoAuth.js'

type Demo = {
  name: string
  email: string
  password: string
  profile: Record<string, unknown>
}

const PASSWORD = DEMO_PASSWORD

export const DEMO_USERS: Demo[] = [
  {
    name: 'Asha',
    email: usernameToEmail('Asha')!,
    password: PASSWORD,
    profile: {
      dob: '1967-04-12',
      sex: 'female',
      height_cm: 158,
      conditions: ['hypertension', 'ckd'],
      medications: [
        { name: 'Amlodipine 5mg', purpose: 'blood pressure', timing: 'morning' },
        { name: 'Telmisartan 40mg', purpose: 'blood pressure', timing: 'morning' },
      ],
      // ckd gates every potassium and protein suggestion — the point of this profile.
      constraints: { ckd: true, pregnant: false, ed_history: false, exercise_restricted: false },
      goals: ['bp_log', 'sodium', 'med_adherence'],
      onboarding_answers: { context: 'Cooks for the whole family, so low-salt food has to work for everyone.' },
      derived: {
        summary:
          'Manages stage 3 kidney disease alongside high blood pressure on amlodipine and telmisartan. Cooks for a family, so dietary advice has to survive a shared dinner table. Kidney disease rules out the usual potassium-heavy low-sodium swaps.',
      },
    },
  },
  {
    name: 'Ravi',
    email: usernameToEmail('Ravi')!,
    password: PASSWORD,
    profile: {
      dob: '1985-09-02',
      sex: 'male',
      height_cm: 174,
      conditions: ['t2d', 'dyslipidemia'],
      medications: [
        { name: 'Metformin 1000mg', purpose: 'blood sugar', timing: 'with dinner' },
        { name: 'Atorvastatin 20mg', purpose: 'cholesterol', timing: 'night' },
      ],
      constraints: { ckd: false, pregnant: false, ed_history: false, exercise_restricted: false },
      goals: ['glucose_log', 'steps', 'sleep'],
      onboarding_answers: { context: 'Night shifts three days a week, eats whatever the canteen has at 2am.' },
      derived: {
        summary:
          'Type 2 diabetes and high cholesterol, on metformin and atorvastatin. Works rotating night shifts, so meal timing and sleep are the hard parts rather than motivation.',
      },
    },
  },
  {
    name: 'Meera',
    email: usernameToEmail('Meera')!,
    password: PASSWORD,
    profile: {
      dob: '1994-01-23',
      sex: 'female',
      height_cm: 163,
      conditions: ['prediabetes'],
      medications: [],
      // pregnant suppresses weight-loss and calorie-deficit advice entirely.
      constraints: { ckd: false, pregnant: true, ed_history: false, exercise_restricted: false },
      goals: ['steps', 'water', 'sleep'],
      onboarding_answers: { context: 'Second trimester, desk job, told to watch her sugars.' },
      derived:
        {
          summary:
            'Prediabetic and in her second trimester, on no medication. Pregnancy rules out any weight or calorie framing; the useful advice is about steady blood sugar and gentle movement.',
        },
    },
  },
  {
    name: 'Sam',
    email: usernameToEmail('Sam')!,
    password: PASSWORD,
    profile: {
      dob: '1958-11-30',
      sex: 'male',
      height_cm: 169,
      conditions: ['cardiac', 'hypertension'],
      medications: [
        { name: 'Bisoprolol 2.5mg', purpose: 'heart rate and blood pressure', timing: 'morning' },
        { name: 'Aspirin 75mg', purpose: '', timing: 'morning' },
      ],
      constraints: { ckd: false, pregnant: false, ed_history: false, exercise_restricted: true },
      goals: ['med_adherence', 'bp_log', 'steps'],
      onboarding_answers: { context: 'Bypass surgery two years ago. Cardiologist capped his exertion.' },
      derived: {
        summary:
          'Coronary disease with a bypass two years ago, plus high blood pressure, on bisoprolol and aspirin. Exercise is medically restricted, so anything that sounds like a workout plan is the wrong answer for him.',
      },
    },
  },
]

async function ensureUser(email: string, password: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (data?.user) return data.user.id
  if (!error?.message.toLowerCase().includes('already')) {
    throw new Error(`${email}: ${error?.message ?? 'createUser returned nothing'}`)
  }

  // Left over from a previous run. Reset the password so the documented one works.
  const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (listError) throw new Error(`${email}: ${listError.message}`)
  const found = list.users.find((u) => u.email === email)
  if (!found) throw new Error(`${email}: reported as existing but not listed`)
  const { error: updateError } = await db.auth.admin.updateUserById(found.id, { password })
  if (updateError) throw new Error(`${email}: ${updateError.message}`)
  return found.id
}

for (const user of DEMO_USERS) {
  const id = await ensureUser(user.email, user.password)
  // Upsert, not update: the handle_new_user trigger makes the row for a fresh
  // account, but an account created before the schema existed has no row at all
  // and an update would silently touch nothing.
  const { error } = await db
    .from('profiles')
    .upsert({ id, name: user.name, ...user.profile, onboarded_at: new Date().toISOString() })
  if (error) throw new Error(`${user.email} profile: ${error.message}`)
  console.log(`✓ ${user.email} (${id})`)
}

console.log(`\n${DEMO_USERS.length} demo accounts ready. Password for all of them: ${PASSWORD}`)

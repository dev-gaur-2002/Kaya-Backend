# Kaya — Backend

Express + Supabase + Groq. Deploys to Vercel from the repo root.

## Setup

```bash
npm install
cp .env.example .env   # fill in Supabase + Groq keys
```

Apply the schema and config seed to your Supabase project:

```bash
# Session-mode pooler, from Project Settings -> Database -> Connection string.
# Not db.<ref>.supabase.co — the direct host is IPv6-only and will not resolve
# on an IPv4 network. Port 5432, not the 6543 transaction pooler.
export PGPASSWORD='<database password>'
export PGHOST=aws-0-<region>.pooler.supabase.com PGPORT=5432
export PGUSER=postgres.<project ref> PGDATABASE=postgres

psql -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Pasting both files into the dashboard SQL editor works just as well.

Create a private Storage bucket named `documents` for uploaded lab PDFs.

```bash
npm run seed:demo  # the four demo accounts — see below
npm run dev        # http://localhost:3001/health
npm test           # safety rules, unit conversion, seed validation
npm run typecheck
```

## How it works

Everything the assistant says is shaped by two things: the **user profile** (the
UP) and the **config table**.

- `configs(key, value jsonb)` holds every prompt, the onboarding question set,
  the safety rules, the condition packs and the model settings. Change behaviour
  with a SQL update, no deploy. Each key is validated by a zod schema in
  `src/services/config.schemas.ts` on load — Postgres cannot check jsonb shape,
  so that validator is the only thing between a typo and a dead onboarding flow.
- `profiles` is the UP. `src/services/prompt.ts` renders it into every request
  along with the condition packs for the conditions that user actually has.

### Model

`openai/gpt-oss-120b` on Groq (production, 131k context), set in `configs` under
`llm.settings` — swapping it is a SQL update, not a deploy.

It is a reasoning model, which has two consequences worth knowing:

- **Reasoning tokens count toward `max_tokens`.** That is why the seed sets 2048
  rather than 1024 — too low a budget truncates the answer after the model has
  spent the allowance thinking.
- **`reasoning_effort` is the quality/latency dial.** Chat runs at `medium`;
  onboarding synthesis, document extraction and follow-up openers run at `low`,
  because copying values off a page is not a task that rewards deliberation.

### Safety

`src/services/safety.ts` runs **before** the model. An emergency or urgent rule
match returns its seeded copy verbatim and the model is never called — a
nondeterministic system must not be the only thing between a user and a stroke.
Caution-level matches do not escalate; they are injected into the prompt so the
reply accounts for the number without alarming anyone.

Values extracted from uploaded PDFs land `confirmed: false` and never reach the
prompt until the user confirms them.

## Demo sign-in

There is no password anywhere in this build. The login screen takes a name and
`POST /api/demo/login` does the rest: the name is slugged into
`<name>@kaya.demo`, the account is created on first sight with the admin API,
and the endpoint signs in and returns a real Supabase session. The app sets that
session and everything downstream — bearer tokens, refresh, RLS — is unchanged.

The username is the account key, so it is collapsed before use: `Asha`,
`  ASHA  ` and `Asha!` are all `asha@kaya.demo`. `Asha Rao` is someone else.
A name with no letters or digits in it is a 400 rather than a shared account.

Whether a returning name sees onboarding is just `profiles.onboarded_at` — the
app's gate reads it, so a name that finished onboarding lands straight in chat
and a new one starts at question one.

`npm run seed:demo` (`src/scripts/seedDemoUsers.ts`) pre-builds four of these
accounts with finished profiles, so the app has something to show before anyone
has onboarded. Type the name to enter:

| Name | Profile |
|---|---|
| `Asha` | 58F — high blood pressure + stage 3 kidney disease, amlodipine and telmisartan. `constraints.ckd` is on, which gates potassium and protein advice. |
| `Ravi` | 41M — type 2 diabetes + high cholesterol, metformin and atorvastatin, rotating night shifts. |
| `Meera` | 32F — prediabetes, second trimester. `constraints.pregnant` suppresses all weight and calorie framing. |
| `Sam` | 67M — coronary disease + high blood pressure, bisoprolol and aspirin. `constraints.exercise_restricted` rules out workout plans. |

The four exist to show the constraint machinery doing something: ask all of them
the same question and the answers should differ. Re-running the script resets
their profiles, so a demo can always be put back to a known state.

Anyone who knows a name is that user. That is the point for a demo and
disqualifying for anything else — only point this at a project with no real data
in it, and replace `services/demoAuth.ts` with real credentials before it has
any.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/health` | |
| GET | `/api/config/onboarding` | question set (public) |
| GET | `/api/config/goals` | goal catalogue (public) |
| POST | `/api/demo/login` | `{ username }` → session, creating the account if new (public) |
| GET | `/api/profile` | the UP, vitals, adherence, rendered prompt block |
| POST | `/api/onboarding/answers` | answers → synthesized UP |
| POST | `/api/chat` | `{ message, conversationId?, vitals? }` |
| GET | `/api/conversations/:id/messages` | |
| POST/GET | `/api/vitals` | log / list |
| POST | `/api/vitals/:id/confirm` | promote a PDF-extracted value |
| POST/GET | `/api/documents` | upload a lab PDF / list |
| POST | `/api/goals/:code/log` | |
| GET | `/api/followups/due` | |
| POST | `/api/followups/queue` | |

All `/api` routes except `/api/config/*` and `/api/demo/login` require
`Authorization: Bearer <supabase access token>`.

# Kaya — Backend

Express + Supabase + Groq. Deploys to Vercel from the repo root.

## Setup

```bash
npm install
cp .env.example .env   # fill in Supabase + Groq keys
```

Apply the schema and config seed to your Supabase project:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Create a private Storage bucket named `documents` for uploaded lab PDFs.

```bash
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

### Safety

`src/services/safety.ts` runs **before** the model. An emergency or urgent rule
match returns its seeded copy verbatim and the model is never called — a
nondeterministic system must not be the only thing between a user and a stroke.
Caution-level matches do not escalate; they are injected into the prompt so the
reply accounts for the number without alarming anyone.

Values extracted from uploaded PDFs land `confirmed: false` and never reach the
prompt until the user confirms them.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/health` | |
| GET | `/api/config/onboarding` | question set (public) |
| GET | `/api/config/goals` | goal catalogue (public) |
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

All `/api` routes except `/api/config/*` require `Authorization: Bearer <supabase access token>`.

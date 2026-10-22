-- Kaya — initial schema.
-- Rule applied throughout: bounded and always read whole -> jsonb on profiles.
-- Unbounded, append-only, or queried by range -> its own table.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- config
create table public.configs (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);
comment on table public.configs is
  'All app config. Validated by zod on load in services/config.ts — Postgres cannot check jsonb shape.';

-- ---------------------------------------------------------------- the UP
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  dob                date,
  sex                text,
  height_cm          numeric,
  conditions         jsonb not null default '[]'::jsonb,
  medications        jsonb not null default '[]'::jsonb,
  constraints        jsonb not null default '{}'::jsonb,
  goals              jsonb not null default '[]'::jsonb,
  onboarding_answers jsonb not null default '{}'::jsonb,
  derived            jsonb,
  profile_version    int  not null default 1,
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on column public.profiles.constraints is
  'Advice gates: pregnant, ckd, ed_history, under_18. Each suppresses a class of advice.';

-- ---------------------------------------------------------------- documents
create table public.documents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  storage_path   text not null,
  filename       text not null,
  bytes          int  not null,
  extracted_text text,
  has_text_layer boolean,
  status         text not null default 'pending'
                 check (status in ('pending','extracted','no_text','failed')),
  error          text,
  uploaded_at    timestamptz not null default now()
);
create index on public.documents (user_id, uploaded_at desc);

-- ---------------------------------------------------------------- vitals
create table public.vitals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  value       numeric not null,
  unit        text not null,
  raw_value   numeric,          -- as printed on the source document
  raw_unit    text,
  measured_at timestamptz not null,
  source      text not null check (source in ('self_report','document','device')),
  document_id uuid references public.documents(id) on delete set null,
  confirmed   boolean not null default true,
  created_at  timestamptz not null default now()
);
-- The query this table exists to serve: this user's recent readings of one kind.
create index on public.vitals (user_id, kind, measured_at desc);
comment on column public.vitals.confirmed is
  'false for values extracted from a PDF until the user confirms them. Unconfirmed values never reach the prompt.';

-- ---------------------------------------------------------------- goals
create table public.goal_logs (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  goal_code text not null,      -- references configs goals.catalogue by code, not FK
  log_date  date not null,
  value     numeric,
  completed boolean not null default false,
  unique (user_id, goal_code, log_date)
);
create index on public.goal_logs (user_id, log_date desc);

-- ---------------------------------------------------------------- chat
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  title           text,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index on public.conversations (user_id, last_message_at desc);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  safety_rule_key text,          -- which rule fired, if any; audit breadcrumb
  tokens          int,
  created_at      timestamptz not null default now()
);
create index on public.messages (conversation_id, created_at);

create table public.follow_ups (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  reason          text not null,
  opener          text not null,
  due_at          timestamptz not null,
  status          text not null default 'queued'
                  check (status in ('queued','delivered','dismissed')),
  created_at      timestamptz not null default now()
);
create index on public.follow_ups (user_id, status, due_at);

-- ---------------------------------------------------------------- RLS
-- The backend uses the service-role key and bypasses all of this. It exists
-- because the anon key ships inside the app bundle and is public by design —
-- RLS is the only thing protecting this data if the app ever queries directly.
alter table public.profiles      enable row level security;
alter table public.documents     enable row level security;
alter table public.vitals        enable row level security;
alter table public.goal_logs     enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.follow_ups    enable row level security;
alter table public.configs       enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own documents" on public.documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own vitals" on public.vitals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own goal_logs" on public.goal_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own follow_ups" on public.follow_ups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Messages have no user_id; ownership runs through the parent conversation.
create policy "own messages" on public.messages
  for all using (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  );

-- Config is readable by any signed-in user (the app renders the question set
-- from it) and writable only via the service role, which bypasses RLS entirely.
create policy "read config" on public.configs for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------- triggers
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A profile row must exist before onboarding can write to it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

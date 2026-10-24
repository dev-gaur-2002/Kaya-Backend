-- Profile identity + multi-page reports.

-- The sign-in name was already being collected and discarded into a synthetic
-- email. The profile screen needs it back.
alter table public.profiles add column name text;

-- A photographed report arrives as a set of images rather than one file. One
-- documents row still covers the whole upload; storage_path stays as pages[0]
-- so everything already reading it keeps working.
alter table public.documents add column pages jsonb not null default '[]'::jsonb;
comment on column public.documents.pages is
  'Storage paths for every file in one upload. One entry for a PDF, N for an image set.';

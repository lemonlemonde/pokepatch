-- Admin-curated lookup of Pokemon set full names -> short abbreviations
-- (used for Google Drive folder naming, etc). Distinct from the live
-- card name/set dropdown, which is derived from cards already on orders.
create table if not exists public.set_library (
  id uuid primary key default gen_random_uuid(),
  set_name text not null,
  abbreviation text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists set_library_set_name_key
  on public.set_library (lower(set_name));

alter table public.set_library enable row level security;

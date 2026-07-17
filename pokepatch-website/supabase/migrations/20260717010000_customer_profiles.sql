-- PokePatch: customer profiles
--
-- Stores a saved profile per customer account so logged-in users don't have to
-- re-enter their name and contact methods (socials) on every quote. The quote
-- form pre-fills from this profile; the account email always comes from auth.
--
-- SAFETY
-- - Additive: creates one new table and its own policies.
-- - Never touches quote_requests, orders, or existing policies.
-- - Wrapped in a transaction; safe to re-run.

begin;

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  contacts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;

-- A customer can only ever read or write their own profile row.
drop policy if exists "users can read their own profile" on public.customer_profiles;
create policy "users can read their own profile"
  on public.customer_profiles for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users can insert their own profile" on public.customer_profiles;
create policy "users can insert their own profile"
  on public.customer_profiles for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users can update their own profile" on public.customer_profiles;
create policy "users can update their own profile"
  on public.customer_profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.customer_profiles to authenticated;

commit;

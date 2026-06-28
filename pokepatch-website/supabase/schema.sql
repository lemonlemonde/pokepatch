-- PokePatch: quote_requests schema
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- WARNING: the DROP recreates the table and deletes existing rows.
-- Remove the DROP line if you want to keep existing data (then alter manually).

drop table if exists public.quote_requests;

create table public.quote_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  delivery_method text not null check (delivery_method in ('local_dropoff', 'shipping')),
  restoration_details text not null,
  contact text not null,
  image_paths text[] not null default '{}'
);

alter table public.quote_requests enable row level security;

-- Anonymous (publishable key) visitors may only INSERT; never read.
create policy "anon can insert quote requests"
  on public.quote_requests
  for insert
  to anon
  with check (true);

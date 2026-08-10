-- Local mirror of the Pokémon TCG API's /sets endpoint.
--
-- The upstream API returns 5xx for a large share of requests, so nothing on a
-- request path should call it. A sync job refreshes this table (sets change a
-- handful of times a year) and the admin UI reads only from here.
--
-- ptcgo_code is the official short code (e.g. "SVI") and is what set_library
-- used to be maintained by hand for. It is blank for many promo and older
-- sets, so set_library survives as a manual override layer on top of this.
create table if not exists public.set_catalog (
  id text primary key,
  name text not null,
  series text not null default '',
  ptcgo_code text not null default '',
  printed_total integer,
  total integer,
  release_date date,
  symbol_url text not null default '',
  logo_url text not null default '',
  synced_at timestamptz not null default now()
);

create index if not exists set_catalog_name_idx
  on public.set_catalog (lower(name));

create index if not exists set_catalog_release_date_idx
  on public.set_catalog (release_date desc nulls last);

alter table public.set_catalog enable row level security;

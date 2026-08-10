-- Local mirror of every supported TCG's card list.
--
-- Search runs here, not against the upstream APIs: the quote form is public,
-- and the Pokémon API alone caps anonymous callers at 1000/day. Synced by
-- scripts/sync-card-catalog.mjs.
create table if not exists public.card_catalog (
  game text not null,
  card_id text not null,
  name text not null,
  set_name text not null default '',
  number text not null default '',
  image_thumb text not null default '',
  image_large text not null default '',
  synced_at timestamptz not null default now(),
  primary key (game, card_id)
);

create extension if not exists pg_trgm;

create index if not exists card_catalog_name_trgm_idx
  on public.card_catalog using gin (name gin_trgm_ops);

create index if not exists card_catalog_set_trgm_idx
  on public.card_catalog using gin (set_name gin_trgm_ops);

alter table public.card_catalog enable row level security;

-- Public read via this function only — the table itself stays closed.
create or replace function public.search_cards(
  p_query text,
  p_game text default null,
  p_limit integer default 24
)
returns table (
  game text,
  card_id text,
  name text,
  set_name text,
  number text,
  image_thumb text,
  image_large text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.game, c.card_id, c.name, c.set_name, c.number,
         c.image_thumb, c.image_large
  from public.card_catalog c
  where btrim(coalesce(p_query, '')) <> ''
    and (p_game is null or c.game = p_game)
    and (c.name ilike '%' || btrim(p_query) || '%'
         or c.set_name ilike '%' || btrim(p_query) || '%')
  order by
    -- Exact and prefix hits first, then closest by trigram similarity.
    (lower(c.name) = lower(btrim(p_query))) desc,
    (lower(c.name) like lower(btrim(p_query)) || '%') desc,
    similarity(c.name, btrim(p_query)) desc,
    c.name
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

grant execute on function public.search_cards(text, text, integer) to anon, authenticated;

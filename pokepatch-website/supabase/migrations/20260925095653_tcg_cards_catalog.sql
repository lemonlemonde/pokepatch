-- Local mirror of the Pokémon TCG card catalog (PokemonTCG/pokemon-tcg-data).
-- Admin card search / "Use card" read from here instead of calling
-- api.pokemontcg.io at request time. Rows are upserted by
-- scripts/sync-tcg-catalog.mjs (CI: .github/workflows/sync-tcg-catalog.yml).
-- Ids match the API / existing gallery_items.tcg_card_id / cards.tcg_card_id.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.tcg_cards (
  id text PRIMARY KEY,
  name text NOT NULL,
  number text NOT NULL DEFAULT '',
  set_id text NOT NULL,
  set_name text NOT NULL DEFAULT '',
  set_series text,
  release_date date,
  image_small text NOT NULL DEFAULT '',
  image_large text NOT NULL DEFAULT '',
  synced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tcg_cards IS
  'Mirror of the Pokémon TCG API card catalog for admin search. Service role only; refreshed by sync-tcg-catalog.';
COMMENT ON COLUMN public.tcg_cards.image_small IS
  'Small render URL from the dataset (images.pokemontcg.io or images.scrydex.com).';

CREATE INDEX IF NOT EXISTS tcg_cards_name_trgm_idx
  ON public.tcg_cards USING gin (lower(name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tcg_cards_set_name_trgm_idx
  ON public.tcg_cards USING gin (lower(set_name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tcg_cards_set_number_idx
  ON public.tcg_cards (set_id, number);

-- No policies on purpose: only the service role (edge functions, sync script) reads/writes.
ALTER TABLE public.tcg_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tcg_cards FROM anon, authenticated;

-- Ranked catalog search. Name/set are matched by substring first, then trigram
-- similarity (typo tolerance). Ties break newest set first.
CREATE OR REPLACE FUNCTION public.search_tcg_cards(
  p_name text DEFAULT '',
  p_set text DEFAULT '',
  p_number text DEFAULT '',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 100
)
RETURNS TABLE (
  id text,
  name text,
  number text,
  set_id text,
  set_name text,
  release_date date,
  image_small text,
  image_large text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_name text := lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
  v_set text := lower(btrim(regexp_replace(coalesce(p_set, ''), '\s+', ' ', 'g')));
  v_number text := lower(btrim(coalesce(p_number, '')));
  v_name_like text;
  v_set_like text;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 100), 1), 250);
BEGIN
  IF v_name = '' AND v_set = '' AND v_number = '' THEN
    RETURN;
  END IF;

  v_name_like := replace(replace(replace(v_name, '\', '\\'), '%', '\%'), '_', '\_');
  v_set_like := replace(replace(replace(v_set, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN QUERY
  WITH matched AS (
    SELECT
      c.id,
      c.name,
      c.number,
      c.set_id,
      c.set_name,
      c.release_date,
      c.image_small,
      c.image_large,
      CASE
        WHEN v_name = '' THEN 1.0
        WHEN lower(c.name) = v_name THEN 1.0
        WHEN lower(c.name) LIKE v_name_like || '%' THEN 0.9
        WHEN lower(c.name) LIKE '%' || v_name_like || '%' THEN 0.8
        ELSE similarity(lower(c.name), v_name) * 0.7
      END AS name_score,
      CASE
        WHEN v_set = '' THEN 1.0
        WHEN lower(c.set_name) = v_set OR lower(c.set_id) = v_set THEN 1.0
        WHEN lower(c.set_name) LIKE v_set_like || '%' THEN 0.9
        WHEN lower(c.set_name) LIKE '%' || v_set_like || '%' THEN 0.8
        ELSE similarity(lower(c.set_name), v_set) * 0.7
      END AS set_score
    FROM public.tcg_cards c
    WHERE
      (
        v_name = ''
        OR lower(c.name) LIKE '%' || v_name_like || '%'
        OR lower(c.name) % v_name
      )
      AND (
        v_set = ''
        OR lower(c.set_id) = v_set
        OR lower(c.set_name) LIKE '%' || v_set_like || '%'
        OR lower(c.set_name) % v_set
      )
      AND (v_number = '' OR lower(c.number) = v_number)
  )
  SELECT
    m.id,
    m.name,
    m.number,
    m.set_id,
    m.set_name,
    m.release_date,
    m.image_small,
    m.image_large,
    count(*) OVER () AS total_count
  FROM matched m
  ORDER BY
    (m.name_score + m.set_score) DESC,
    m.release_date DESC NULLS LAST,
    m.set_id,
    NULLIF(left(regexp_replace(m.number, '\D', '', 'g'), 9), '')::bigint NULLS LAST,
    m.number
  OFFSET (v_page - 1) * v_size
  LIMIT v_size;
END;
$$;

COMMENT ON FUNCTION public.search_tcg_cards IS
  'Admin catalog search over tcg_cards (service role). total_count repeats the full match count on every row.';

REVOKE ALL ON FUNCTION public.search_tcg_cards(text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_tcg_cards(text, text, text, integer, integer) TO service_role;

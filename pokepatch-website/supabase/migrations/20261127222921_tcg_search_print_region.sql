-- Filter catalog search by print region (en / jp). Empty p_print_region
-- searches both languages.

DROP FUNCTION IF EXISTS public.search_tcg_cards(text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.search_tcg_cards(text, text, text, integer, integer, text);

CREATE FUNCTION public.search_tcg_cards(
  p_name text DEFAULT '',
  p_set text DEFAULT '',
  p_number text DEFAULT '',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 100,
  p_print_region text DEFAULT ''
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
  print_region text,
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
  v_region text := lower(btrim(coalesce(p_print_region, '')));
  v_name_like text;
  v_set_like text;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 100), 1), 250);
BEGIN
  IF v_region NOT IN ('en', 'jp') THEN
    v_region := '';
  END IF;

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
      c.print_region,
      CASE
        WHEN v_name = '' THEN 1.0
        ELSE GREATEST(
          CASE
            WHEN lower(c.name) = v_name THEN 1.0
            WHEN lower(c.name) LIKE v_name_like || '%' THEN 0.9
            WHEN lower(c.name) LIKE '%' || v_name_like || '%' THEN 0.8
            WHEN lower(c.name) % v_name THEN similarity(lower(c.name), v_name) * 0.7
            ELSE 0.0
          END,
          CASE
            WHEN c.name_ja = '' THEN 0.0
            WHEN lower(c.name_ja) = v_name THEN 1.0
            WHEN lower(c.name_ja) LIKE v_name_like || '%' THEN 0.9
            WHEN lower(c.name_ja) LIKE '%' || v_name_like || '%' THEN 0.8
            WHEN lower(c.name_ja) % v_name THEN similarity(lower(c.name_ja), v_name) * 0.7
            ELSE 0.0
          END
        )
      END AS name_score,
      CASE
        WHEN v_set = '' THEN 1.0
        ELSE GREATEST(
          CASE
            WHEN lower(c.set_name) = v_set OR lower(c.set_id) = v_set THEN 1.0
            WHEN lower(c.set_name) LIKE v_set_like || '%' THEN 0.9
            WHEN lower(c.set_name) LIKE '%' || v_set_like || '%' THEN 0.8
            WHEN lower(c.set_name) % v_set THEN similarity(lower(c.set_name), v_set) * 0.7
            ELSE 0.0
          END,
          CASE
            WHEN c.set_name_ja = '' THEN 0.0
            WHEN lower(c.set_name_ja) = v_set THEN 1.0
            WHEN lower(c.set_name_ja) LIKE v_set_like || '%' THEN 0.9
            WHEN lower(c.set_name_ja) LIKE '%' || v_set_like || '%' THEN 0.8
            WHEN lower(c.set_name_ja) % v_set THEN similarity(lower(c.set_name_ja), v_set) * 0.7
            ELSE 0.0
          END
        )
      END AS set_score
    FROM public.tcg_cards c
    WHERE
      (v_region = '' OR c.print_region = v_region)
      AND (
        v_name = ''
        OR lower(c.name) LIKE '%' || v_name_like || '%'
        OR lower(c.name) % v_name
        OR (
          c.name_ja <> ''
          AND (
            lower(c.name_ja) LIKE '%' || v_name_like || '%'
            OR lower(c.name_ja) % v_name
          )
        )
      )
      AND (
        v_set = ''
        OR lower(c.set_id) = v_set
        OR lower(c.set_name) LIKE '%' || v_set_like || '%'
        OR lower(c.set_name) % v_set
        OR (
          c.set_name_ja <> ''
          AND (
            lower(c.set_name_ja) LIKE '%' || v_set_like || '%'
            OR lower(c.set_name_ja) % v_set
          )
        )
      )
      AND (v_number = '' OR lower(c.number) = v_number)
  ),
  ranked AS (
    SELECT
      m.*,
      row_number() OVER (
        PARTITION BY m.print_region
        ORDER BY
          m.release_date DESC NULLS LAST,
          m.set_id,
          NULLIF(left(regexp_replace(m.number, '\D', '', 'g'), 9), '')::bigint NULLS LAST,
          m.number
      ) AS region_rank
    FROM matched m
  )
  SELECT
    r.id,
    r.name,
    r.number,
    r.set_id,
    r.set_name,
    r.release_date,
    r.image_small,
    r.image_large,
    r.print_region,
    count(*) OVER () AS total_count
  FROM ranked r
  ORDER BY
    (r.name_score + r.set_score) DESC,
    r.region_rank,
    r.print_region,
    r.set_id,
    r.number
  OFFSET (v_page - 1) * v_size
  LIMIT v_size;
END;
$$;

COMMENT ON FUNCTION public.search_tcg_cards IS
  'Admin catalog search over tcg_cards (service role). p_print_region en|jp filters to that language; empty searches both. total_count repeats the full match count on every row.';

REVOKE ALL ON FUNCTION public.search_tcg_cards(text, text, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_tcg_cards(text, text, text, integer, integer, text) TO service_role;

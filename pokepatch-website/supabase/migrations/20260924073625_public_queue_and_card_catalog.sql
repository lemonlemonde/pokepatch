-- Public queue board (anonymized) + optional catalog thumbnails on order cards.
-- Catalog images are official TCG art (or admin-uploaded public URLs) — never customer photos.

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS tcg_card_id text,
  ADD COLUMN IF NOT EXISTS catalog_image_url text;

COMMENT ON COLUMN public.cards.tcg_card_id IS
  'Pokémon TCG API card id for official catalog art on the public queue.';
COMMENT ON COLUMN public.cards.catalog_image_url IS
  'Public URL for queue/catalog thumbnail (TCG CDN or gallery storage). Not customer photos.';

-- Anonymized dual queue for the public /queue page. No names, emails, notes, or photos.
CREATE OR REPLACE FUNCTION public.get_public_queue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH queued AS (
    SELECT
      o.display_id,
      o.is_priority,
      o.created_at,
      o.id,
      (
        SELECT count(*)::integer
        FROM public.cards c
        WHERE c.order_id = o.id
          AND c.status IS DISTINCT FROM 'canceled'
      ) AS card_count
    FROM public.orders o
    WHERE o.status = 'new'
  ),
  priority_lane AS (
    SELECT
      q.display_id,
      q.card_count,
      row_number() OVER (
        ORDER BY q.created_at ASC NULLS LAST, q.id ASC
      )::integer AS lane_position
    FROM queued q
    WHERE q.is_priority = true
  ),
  regular_lane AS (
    SELECT
      q.display_id,
      q.card_count,
      row_number() OVER (
        ORDER BY q.created_at ASC NULLS LAST, q.id ASC
      )::integer AS lane_position
    FROM queued q
    WHERE q.is_priority = false
  )
  SELECT jsonb_build_object(
    'priority',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'display_id', p.display_id,
            'lane_position', p.lane_position,
            'card_count', p.card_count
          )
          ORDER BY p.lane_position ASC
        )
        FROM priority_lane p
      ),
      '[]'::jsonb
    ),
    'regular',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'display_id', r.display_id,
            'lane_position', r.lane_position,
            'card_count', r.card_count
          )
          ORDER BY r.lane_position ASC
        )
        FROM regular_lane r
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_queue() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_queue() TO anon, authenticated, service_role;

-- Cards for one queued order (by public display id). Empty if not in To do.
CREATE OR REPLACE FUNCTION public.get_public_queue_order(p_display_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lane_position integer;
  v_global_position integer;
  v_cards jsonb;
BEGIN
  IF p_display_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.display_id = p_display_id
    AND o.status = 'new'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT q.lane_position INTO v_lane_position
  FROM (
    SELECT
      o2.id,
      row_number() OVER (
        ORDER BY o2.created_at ASC NULLS LAST, o2.id ASC
      )::integer AS lane_position
    FROM public.orders o2
    WHERE o2.status = 'new'
      AND o2.is_priority = v_order.is_priority
  ) q
  WHERE q.id = v_order.id;

  SELECT q.queue_position INTO v_global_position
  FROM (
    SELECT
      o2.id,
      row_number() OVER (
        ORDER BY o2.is_priority DESC, o2.created_at ASC NULLS LAST, o2.id ASC
      )::integer AS queue_position
    FROM public.orders o2
    WHERE o2.status = 'new'
  ) q
  WHERE q.id = v_order.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'card_name', c.card_name,
        'set_name', c.set_name,
        'catalog_image_url', c.catalog_image_url,
        'tcg_card_id', c.tcg_card_id,
        'sort_order', c.sort_order
      )
      ORDER BY c.sort_order ASC NULLS LAST, c.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_cards
  FROM public.cards c
  WHERE c.order_id = v_order.id
    AND c.status IS DISTINCT FROM 'canceled';

  RETURN jsonb_build_object(
    'display_id', v_order.display_id,
    'is_priority', v_order.is_priority,
    'lane_position', v_lane_position,
    'queue_position', v_global_position,
    'cards', v_cards
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_queue_order(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_queue_order(bigint) TO anon, authenticated, service_role;

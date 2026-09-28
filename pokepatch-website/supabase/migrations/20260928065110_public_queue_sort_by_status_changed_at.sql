-- Match public /queue To do + In progress to admin those columns:
-- priority first, then earliest status_changed_at (when the order entered
-- that column), with created_at / id as tiebreakers.
-- See sortOrdersForStatusColumn in src/lib/orderStatus.js.

CREATE OR REPLACE FUNCTION public.get_public_queue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH board AS (
    SELECT
      o.id,
      o.display_id,
      o.status,
      o.is_priority,
      o.created_at,
      o.status_changed_at,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'card_name', c.card_name,
              'set_name', c.set_name,
              'catalog_card_name', c.catalog_card_name,
              'catalog_set_name', c.catalog_set_name,
              'catalog_image_url', c.catalog_image_url,
              'tcg_card_id', c.tcg_card_id,
              'damage_tags', COALESCE(c.damage_tags, '{}'::text[]),
              'sort_order', c.sort_order
            )
            ORDER BY c.sort_order ASC NULLS LAST, c.id ASC
          )
          FROM public.cards c
          WHERE c.order_id = o.id
            AND c.status IS DISTINCT FROM 'canceled'
        ),
        '[]'::jsonb
      ) AS cards,
      (
        SELECT count(*)::integer
        FROM public.cards c
        WHERE c.order_id = o.id
          AND c.status IS DISTINCT FROM 'canceled'
      ) AS card_count
    FROM public.orders o
    WHERE o.status IN ('new', 'in_progress')
  ),
  priority_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY
          COALESCE(b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'new' AND b.is_priority = true
  ),
  regular_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY
          COALESCE(b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'new' AND b.is_priority = false
  ),
  in_progress_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY
          b.is_priority DESC,
          COALESCE(b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'in_progress'
  )
  SELECT jsonb_build_object(
    'in_progress',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'display_id', i.display_id,
            'lane_position', i.lane_position,
            'card_count', i.card_count,
            'is_priority', i.is_priority,
            'cards', i.cards
          )
          ORDER BY i.lane_position ASC
        )
        FROM in_progress_lane i
      ),
      '[]'::jsonb
    ),
    'priority',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'display_id', p.display_id,
            'lane_position', p.lane_position,
            'card_count', p.card_count,
            'is_priority', true,
            'cards', p.cards
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
            'card_count', r.card_count,
            'is_priority', false,
            'cards', r.cards
          )
          ORDER BY r.lane_position ASC
        )
        FROM regular_lane r
      ),
      '[]'::jsonb
    )
  );
$$;

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
    AND o.status IN ('new', 'in_progress')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_order.status = 'new' THEN
    SELECT q.lane_position INTO v_lane_position
    FROM (
      SELECT
        o2.id,
        row_number() OVER (
          ORDER BY
            COALESCE(o2.status_changed_at, o2.created_at) ASC NULLS LAST,
            o2.created_at ASC NULLS LAST,
            o2.id ASC
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
          ORDER BY
            o2.is_priority DESC,
            COALESCE(o2.status_changed_at, o2.created_at) ASC NULLS LAST,
            o2.created_at ASC NULLS LAST,
            o2.id ASC
        )::integer AS queue_position
      FROM public.orders o2
      WHERE o2.status = 'new'
    ) q
    WHERE q.id = v_order.id;
  ELSE
    SELECT q.lane_position INTO v_lane_position
    FROM (
      SELECT
        o2.id,
        row_number() OVER (
          ORDER BY
            o2.is_priority DESC,
            COALESCE(o2.status_changed_at, o2.created_at) ASC NULLS LAST,
            o2.created_at ASC NULLS LAST,
            o2.id ASC
        )::integer AS lane_position
      FROM public.orders o2
      WHERE o2.status = 'in_progress'
    ) q
    WHERE q.id = v_order.id;

    v_global_position := NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'card_name', c.card_name,
        'set_name', c.set_name,
        'catalog_image_url', c.catalog_image_url,
        'tcg_card_id', c.tcg_card_id,
        'damage_tags', coalesce(c.damage_tags, '{}'::text[]),
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
    'status', v_order.status,
    'is_priority', v_order.is_priority,
    'lane_position', v_lane_position,
    'queue_position', v_global_position,
    'cards', v_cards
  );
END;
$$;

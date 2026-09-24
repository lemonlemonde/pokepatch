-- Public queue board: inline each order's (non-canceled) cards so the page can
-- render the whole board from one call. Card payload matches
-- get_public_queue_order: name, set, catalog image, tcg id, damage tags.

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
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'card_name', c.card_name,
              'set_name', c.set_name,
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
        ORDER BY b.created_at ASC NULLS LAST, b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'new' AND b.is_priority = true
  ),
  regular_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY b.created_at ASC NULLS LAST, b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'new' AND b.is_priority = false
  ),
  in_progress_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY b.is_priority DESC, b.created_at ASC NULLS LAST, b.id ASC
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

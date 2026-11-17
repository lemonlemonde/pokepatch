-- Add Immediate ($100/card): skip the waiting lanes; admin always pulls it next.
-- Customer-facing names: Standard, Priority ($15 / queue_speed=fast), Express ($30), Immediate ($100).
-- create_order / split already partition by distinct queue_speed values.

ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_queue_speed_check;
ALTER TABLE public.cards
  ADD CONSTRAINT cards_queue_speed_check
  CHECK (queue_speed IN ('standard', 'fast', 'express', 'immediate'));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_queue_speed_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_queue_speed_check
  CHECK (queue_speed IN ('standard', 'fast', 'express', 'immediate'));

COMMENT ON COLUMN public.cards.queue_speed IS
  'standard (included), fast/Priority ($15), express ($30), immediate ($100 start next). Mixed speeds split.';
COMMENT ON COLUMN public.orders.queue_speed IS
  'Queue lane for this order. Homogeneous: every card on the order shares this speed.';

CREATE OR REPLACE FUNCTION public.normalize_queue_speed(p_speed text, p_is_priority boolean DEFAULT false)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('standard', 'fast', 'express', 'immediate')
      THEN lower(trim(p_speed))
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('priority', 'rare') THEN 'fast'
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('regular', 'normal') THEN 'standard'
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('ultra', 'rush') THEN 'express'
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('now', 'start', 'jump') THEN 'immediate'
    WHEN coalesce(p_is_priority, false) THEN 'fast'
    ELSE 'standard'
  END;
$$;

CREATE OR REPLACE FUNCTION public.queue_speed_rank(p_speed text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE public.normalize_queue_speed(p_speed, false)
    WHEN 'immediate' THEN 3
    WHEN 'express' THEN 2
    WHEN 'fast' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.queue_speed_fee(p_speed text, p_card_count integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
    GREATEST(0, COALESCE(p_card_count, 0))
    * CASE public.normalize_queue_speed(p_speed, false)
        WHEN 'immediate' THEN 100
        WHEN 'express' THEN 30
        WHEN 'fast' THEN 15
        ELSE 0
      END
  )::numeric(10, 2);
$$;

CREATE OR REPLACE FUNCTION public.queue_speed_adjustment_label(p_speed text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE public.normalize_queue_speed(p_speed, false)
    WHEN 'immediate' THEN 'Immediate start'
    WHEN 'express' THEN 'Express queue'
    WHEN 'fast' THEN 'Priority queue'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_queue_speed_adjustment_label(p_description text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(trim(coalesce(p_description, ''))) IN (
    'immediate start',
    'express queue',
    'priority queue',
    'fast queue',
    'priority service'
  );
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_queue_speed_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_speed text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.queue_speed IS NOT DISTINCT FROM OLD.queue_speed
     AND NEW.is_priority IS DISTINCT FROM OLD.is_priority THEN
    IF NEW.is_priority THEN
      v_speed := CASE
        WHEN OLD.queue_speed IN ('express', 'immediate') THEN OLD.queue_speed
        ELSE 'fast'
      END;
    ELSE
      v_speed := 'standard';
    END IF;
  ELSE
    v_speed := public.normalize_queue_speed(NEW.queue_speed, false);
    IF v_speed = 'standard' AND coalesce(NEW.is_priority, false) THEN
      v_speed := 'fast';
    END IF;
  END IF;
  NEW.queue_speed := v_speed;
  NEW.is_priority := v_speed IS DISTINCT FROM 'standard';
  RETURN NEW;
END;
$$;

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
      o.queue_speed,
      o.created_at,
      o.status_changed_at,
      o.todo_entered_at,
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
  waiting AS (
    SELECT
      b.*,
      row_number() OVER (
        PARTITION BY b.queue_speed
        ORDER BY
          COALESCE(b.todo_entered_at, b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'new'
  ),
  in_progress_lane AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY
          public.queue_speed_rank(b.queue_speed) DESC,
          COALESCE(b.status_changed_at, b.created_at) ASC NULLS LAST,
          b.created_at ASC NULLS LAST,
          b.id ASC
      )::integer AS lane_position
    FROM board b
    WHERE b.status = 'in_progress'
  ),
  lane_json AS (
    SELECT
      w.queue_speed,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'display_id', w.display_id,
            'lane_position', w.lane_position,
            'card_count', w.card_count,
            'is_priority', w.is_priority,
            'queue_speed', w.queue_speed,
            'cards', w.cards
          )
          ORDER BY w.lane_position ASC
        ),
        '[]'::jsonb
      ) AS orders
    FROM waiting w
    GROUP BY w.queue_speed
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
            'queue_speed', i.queue_speed,
            'cards', i.cards
          )
          ORDER BY i.lane_position ASC
        )
        FROM in_progress_lane i
      ),
      '[]'::jsonb
    ),
    'immediate', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'immediate'), '[]'::jsonb),
    'express', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'express'), '[]'::jsonb),
    'fast', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'fast'), '[]'::jsonb),
    'standard', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'standard'), '[]'::jsonb),
    'priority', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'fast'), '[]'::jsonb),
    'regular', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'standard'), '[]'::jsonb)
  );
$$;

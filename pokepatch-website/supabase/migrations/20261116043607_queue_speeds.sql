-- Three queue speeds: standard (included), fast ($15/card), express ($30/card).
-- One order is one speed. Mixed carts split into homogeneous orders.
-- is_priority stays as a derived flag (queue_speed <> 'standard') for older clients.

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS queue_speed text NOT NULL DEFAULT 'standard';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS queue_speed text NOT NULL DEFAULT 'standard';

UPDATE public.cards
SET queue_speed = CASE WHEN is_priority THEN 'fast' ELSE 'standard' END
WHERE queue_speed IS DISTINCT FROM CASE WHEN is_priority THEN 'fast' ELSE 'standard' END;

UPDATE public.orders
SET queue_speed = CASE WHEN is_priority THEN 'fast' ELSE 'standard' END
WHERE queue_speed IS DISTINCT FROM CASE WHEN is_priority THEN 'fast' ELSE 'standard' END;

ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_queue_speed_check;
ALTER TABLE public.cards
  ADD CONSTRAINT cards_queue_speed_check
  CHECK (queue_speed IN ('standard', 'fast', 'express'));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_queue_speed_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_queue_speed_check
  CHECK (queue_speed IN ('standard', 'fast', 'express'));

COMMENT ON COLUMN public.cards.queue_speed IS
  'standard (included), fast ($15/card), or express ($30/card). Mixed speeds on one order are split.';
COMMENT ON COLUMN public.orders.queue_speed IS
  'Queue lane for this order. Homogeneous: every card on the order shares this speed.';

CREATE OR REPLACE FUNCTION public.normalize_queue_speed(p_speed text, p_is_priority boolean DEFAULT false)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('standard', 'fast', 'express')
      THEN lower(trim(p_speed))
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('priority', 'rare') THEN 'fast'
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('regular', 'normal') THEN 'standard'
    WHEN lower(trim(coalesce(p_speed, ''))) IN ('ultra', 'rush') THEN 'express'
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
    WHEN 'express' THEN 'Express queue'
    WHEN 'fast' THEN 'Fast queue'
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
    'fast queue',
    'express queue',
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
      v_speed := CASE WHEN OLD.queue_speed = 'express' THEN 'express' ELSE 'fast' END;
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

DROP TRIGGER IF EXISTS trg_cards_queue_speed_biu ON public.cards;
CREATE TRIGGER trg_cards_queue_speed_biu
BEFORE INSERT OR UPDATE OF queue_speed, is_priority
ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_queue_speed_columns();

DROP TRIGGER IF EXISTS trg_orders_queue_speed_biu ON public.orders;
CREATE TRIGGER trg_orders_queue_speed_biu
BEFORE INSERT OR UPDATE OF queue_speed, is_priority
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_queue_speed_columns();

DROP INDEX IF EXISTS public.orders_todo_queue_idx;
CREATE INDEX orders_todo_queue_idx
  ON public.orders (
    queue_speed,
    todo_entered_at ASC NULLS LAST,
    created_at ASC NULLS LAST,
    id ASC
  )
  WHERE status = 'new';

CREATE OR REPLACE FUNCTION public.sync_order_priority_quote_adjustment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_speed text;
  v_bulk jsonb;
  v_active_count integer;
  v_fee numeric(10, 2);
  v_adjustments jsonb;
  v_without jsonb;
  v_card_hv jsonb;
  v_next jsonb;
  v_row_id text;
  v_label text;
BEGIN
  SELECT o.queue_speed, o.quote_bulk_counts
  INTO v_speed, v_bulk
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_speed := public.normalize_queue_speed(v_speed, false);

  SELECT count(*)::integer
  INTO v_active_count
  FROM public.cards c
  WHERE c.order_id = p_order_id
    AND c.status IS DISTINCT FROM 'canceled';

  v_fee := public.queue_speed_fee(v_speed, v_active_count);
  v_label := public.queue_speed_adjustment_label(v_speed);

  IF v_bulk IS NOT NULL
     AND jsonb_typeof(v_bulk) = 'object'
     AND coalesce((v_bulk ->> 'version')::integer, 0) IS DISTINCT FROM 2
     AND NOT (v_bulk ? 'adjustments') THEN
    RETURN;
  END IF;

  IF v_bulk IS NULL OR jsonb_typeof(v_bulk) <> 'object' THEN
    v_adjustments := '[]'::jsonb;
    v_card_hv := null;
  ELSE
    v_adjustments := coalesce(v_bulk -> 'adjustments', '[]'::jsonb);
    IF jsonb_typeof(v_adjustments) <> 'array' THEN
      v_adjustments := '[]'::jsonb;
    END IF;
    IF jsonb_typeof(v_bulk -> 'card_hv') = 'array' THEN
      v_card_hv := v_bulk -> 'card_hv';
    ELSE
      v_card_hv := null;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_without
  FROM jsonb_array_elements(v_adjustments) elem
  WHERE NOT public.is_queue_speed_adjustment_label(elem ->> 'description');

  IF v_label IS NOT NULL AND v_fee > 0 THEN
    SELECT elem ->> 'id'
    INTO v_row_id
    FROM jsonb_array_elements(v_adjustments) elem
    WHERE public.is_queue_speed_adjustment_label(elem ->> 'description')
    LIMIT 1;

    v_without := v_without || jsonb_build_array(
      jsonb_build_object(
        'id', coalesce(nullif(trim(coalesce(v_row_id, '')), ''), gen_random_uuid()::text),
        'kind', 'surcharge',
        'description', v_label,
        'amount_dollars', v_fee,
        'amount_percent', null
      )
    );
  END IF;

  IF jsonb_array_length(v_without) = 0
     AND (v_card_hv IS NULL OR jsonb_array_length(v_card_hv) = 0) THEN
    v_next := null;
  ELSE
    v_next := jsonb_build_object('version', 2);
    IF jsonb_array_length(v_without) > 0 THEN
      v_next := jsonb_set(v_next, '{adjustments}', v_without, true);
    END IF;
    IF v_card_hv IS NOT NULL AND jsonb_array_length(v_card_hv) > 0 THEN
      v_next := jsonb_set(v_next, '{card_hv}', v_card_hv, true);
    END IF;
  END IF;

  UPDATE public.orders
  SET quote_bulk_counts = v_next
  WHERE id = p_order_id
    AND quote_bulk_counts IS DISTINCT FROM v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_order_priority_quote_from_cards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id := coalesce(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.queue_speed IS NOT DISTINCT FROM OLD.queue_speed
     AND NEW.is_priority IS NOT DISTINCT FROM OLD.is_priority THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.queue_speed IS NOT DISTINCT FROM OLD.queue_speed
     AND NEW.is_priority IS NOT DISTINCT FROM OLD.is_priority
     AND (NEW.status = 'canceled') = (OLD.status = 'canceled') THEN
    RETURN NEW;
  END IF;

  PERFORM public.sync_order_priority_quote_adjustment(v_order_id);
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cards_sync_priority_quote ON public.cards;
CREATE TRIGGER trg_cards_sync_priority_quote
AFTER INSERT OR DELETE OR UPDATE OF status, queue_speed, is_priority
ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_order_priority_quote_from_cards();

CREATE OR REPLACE FUNCTION public.trg_sync_order_priority_quote_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.queue_speed IS NOT DISTINCT FROM OLD.queue_speed
     AND NEW.is_priority IS NOT DISTINCT FROM OLD.is_priority THEN
    RETURN NEW;
  END IF;
  PERFORM public.sync_order_priority_quote_adjustment(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_priority_quote ON public.orders;
CREATE TRIGGER trg_orders_sync_priority_quote
AFTER UPDATE OF is_priority, queue_speed
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_order_priority_quote_from_order();

CREATE OR REPLACE FUNCTION public.todo_queue_position(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT q.pos
  FROM (
    SELECT
      id,
      row_number() OVER (
        ORDER BY
          public.queue_speed_rank(queue_speed) DESC,
          COALESCE(todo_entered_at, status_changed_at, created_at) ASC NULLS LAST,
          created_at ASC NULLS LAST,
          id ASC
      )::integer AS pos
    FROM public.orders
    WHERE status = 'new'
  ) q
  WHERE q.id = p_order_id;
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
    'express', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'express'), '[]'::jsonb),
    'fast', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'fast'), '[]'::jsonb),
    'standard', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'standard'), '[]'::jsonb),
    'priority', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'fast'), '[]'::jsonb),
    'regular', COALESCE((SELECT orders FROM lane_json WHERE queue_speed = 'standard'), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public._create_order_partition(p_order_id uuid, p_user_id uuid, p_first_name text, p_last_name text, p_customer_name text, p_customer_email text, p_delivery_method text, p_heard_about_source text, p_preferred_type text, p_preferred_value text, p_is_priority boolean, p_contacts jsonb, p_cards jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_contact jsonb;
  v_contact_row public.contacts%rowtype;
  v_card jsonb;
  v_card_id uuid;
  v_card_name text;
  v_set_name text;
  v_card_is_priority boolean;
  v_queue_speed text;
  v_card_queue_speed text;
  v_fee_label text;
  v_card_row public.cards%rowtype;
  v_image jsonb;
  v_image_row public.card_images%rowtype;
  v_images jsonb;
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_service_keys jsonb;
  v_service_key text;
  v_service_label text;
  v_base_amount numeric(10, 2);
  v_seen_keys text[] := '{}';
  v_sort_order int := 0;
  v_card_count int;
  v_priority_fee numeric(10, 2);
  v_quote_bulk jsonb := null;
BEGIN
  v_card_count := jsonb_array_length(p_cards);
  IF v_card_count < 1 THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;

  v_queue_speed := public.normalize_queue_speed(
    p_cards -> 0 ->> 'queue_speed',
    p_is_priority
  );
  v_priority_fee := public.queue_speed_fee(v_queue_speed, v_card_count);
  v_fee_label := public.queue_speed_adjustment_label(v_queue_speed);
  IF v_fee_label IS NOT NULL AND v_priority_fee > 0 THEN
    v_quote_bulk := jsonb_build_object(
      'version', 2,
      'adjustments', jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'kind', 'surcharge',
          'description', v_fee_label,
          'amount_dollars', v_priority_fee,
          'amount_percent', null
        )
      )
    );
  END IF;

  INSERT INTO public.orders (
    id, user_id, first_name, last_name, customer_name, customer_email, delivery_method, general_notes,
    heard_about_source, preferred_contact_type, preferred_contact_value, status, pending_kind, queue_speed,
    quote_bulk_counts
  )
  VALUES (
    p_order_id, p_user_id, p_first_name, p_last_name, p_customer_name, p_customer_email, p_delivery_method, null,
    p_heard_about_source, p_preferred_type, p_preferred_value, 'pending', 'quote', v_queue_speed,
    v_quote_bulk
  )
  RETURNING * INTO v_order;

  INSERT INTO public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes
  )
  VALUES (
    v_order.id,
    v_order.display_id,
    v_order.created_at,
    v_order.first_name,
    v_order.last_name,
    v_order.customer_name,
    v_order.delivery_method,
    v_order.general_notes
  );

  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    INSERT INTO public.contacts (order_id, contact_type, value)
    VALUES (
      p_order_id,
      v_contact ->> 'contact_type',
      trim(v_contact ->> 'value')
    )
    RETURNING * INTO v_contact_row;

    INSERT INTO public.contacts_original (id, order_id, contact_type, value)
    VALUES (
      v_contact_row.id,
      p_order_id,
      v_contact_row.contact_type,
      v_contact_row.value
    );
  END LOOP;

  v_sort_order := 0;

  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    v_card_id := (v_card ->> 'id')::uuid;
    v_card_name := trim(v_card ->> 'card_name');
    v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');
    v_card_queue_speed := public.normalize_queue_speed(
      v_card ->> 'queue_speed',
      coalesce((v_card ->> 'is_priority')::boolean, false)
    );
    v_card_is_priority := v_card_queue_speed IS DISTINCT FROM 'standard';

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    IF v_card ? 'damage_tags' AND v_card -> 'damage_tags' IS NOT NULL
       AND jsonb_typeof(v_card -> 'damage_tags') = 'array' THEN
      FOR v_damage_tag IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_card -> 'damage_tags')
      LOOP
        IF v_damage_tag = '' THEN
          CONTINUE;
        END IF;
        IF v_damage_tag = ANY (v_seen_damage) THEN
          CONTINUE;
        END IF;
        IF v_damage_tag NOT IN (
          'crease',
          'scratching',
          'dent',
          'edge_lift',
          'edge_peeling',
          'dirt',
          'water_damage',
          'warping',
          'whitening'
        ) THEN
          RAISE EXCEPTION 'invalid damage_tag: %', v_damage_tag;
        END IF;
        v_seen_damage := array_append(v_seen_damage, v_damage_tag);
        v_damage_tags := array_append(v_damage_tags, v_damage_tag);
      END LOOP;
    END IF;

    IF coalesce(array_length(v_damage_tags, 1), 0) < 1 THEN
      RAISE EXCEPTION 'each card requires at least one damage_tag';
    END IF;

    INSERT INTO public.cards (id, order_id, card_name, set_name, description, damage_tags, queue_speed)
    VALUES (
      v_card_id,
      p_order_id,
      v_card_name,
      v_set_name,
      nullif(trim(coalesce(v_card ->> 'description', '')), ''),
      v_damage_tags,
      v_card_queue_speed
    )
    RETURNING * INTO v_card_row;

    INSERT INTO public.cards_original (id, order_id, card_name, set_name, description, damage_tags)
    VALUES (
      v_card_row.id,
      p_order_id,
      v_card_row.card_name,
      v_card_row.set_name,
      v_card_row.description,
      v_card_row.damage_tags
    );

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      INSERT INTO public.card_images (card_id, image_type, storage_path)
      VALUES (
        v_card_id,
        coalesce(v_image ->> 'image_type', 'customer'),
        trim(v_image ->> 'storage_path')
      )
      RETURNING * INTO v_image_row;

      INSERT INTO public.card_images_original (id, card_id, image_type, storage_path)
      VALUES (
        v_image_row.id,
        v_image_row.card_id,
        v_image_row.image_type,
        v_image_row.storage_path
      );
    END LOOP;

    v_service_keys := coalesce(v_card -> 'service_keys', '[]'::jsonb);
    IF jsonb_typeof(v_service_keys) = 'array' THEN
      v_seen_keys := '{}';
      FOR v_service_key IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_service_keys)
      LOOP
        IF v_service_key = '' THEN
          CONTINUE;
        END IF;
        IF v_service_key = ANY (v_seen_keys) THEN
          CONTINUE;
        END IF;
        v_seen_keys := array_append(v_seen_keys, v_service_key);

        -- Sync with src/lib/servicePricing.js QUOTE_SERVICES listPrice/title.
        CASE v_service_key
          WHEN 'surface_restoration' THEN
            v_service_label := 'Surface Cleaning';
            v_base_amount := 20;
          WHEN 'precision_pressing' THEN
            v_service_label := 'Minor Damage';
            v_base_amount := 30;
          WHEN 'advanced_restoration' THEN
            v_service_label := 'Major Damage';
            v_base_amount := 50;
          WHEN 'card_whitening' THEN
            v_service_label := 'Minor Whitening';
            v_base_amount := 25;
          WHEN 'card_whitening_major' THEN
            v_service_label := 'Major Whitening';
            v_base_amount := 40;
          WHEN 'slab_cracking' THEN
            v_service_label := 'Slab Cracking';
            v_base_amount := 10;
          ELSE
            RAISE EXCEPTION 'invalid service_key: %', v_service_key;
        END CASE;

        INSERT INTO public.order_quote_items (
          id,
          order_id,
          sort_order,
          card_id,
          card_name,
          set_name,
          service_key,
          service_label,
          quote_base_amount,
          high_value_surcharge
        )
        VALUES (
          gen_random_uuid(),
          p_order_id,
          v_sort_order,
          v_card_id,
          v_card_name,
          v_set_name,
          v_service_key,
          v_service_label,
          v_base_amount,
          null
        );

        v_sort_order := v_sort_order + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_order(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_priority_order_id uuid;
  v_user_id uuid;
  v_first_name text;
  v_last_name text;
  v_customer_name text;
  v_customer_email text;
  v_delivery_method text;
  v_heard_about_source text;
  v_preferred_type text;
  v_preferred_value text;
  v_contacts jsonb;
  v_cards jsonb;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_card_id uuid;
  v_card_name text;
  v_images jsonb;
  v_card_count int;
  v_image_count int;
  v_account_user_id uuid;
  v_profile_contacts jsonb;
  v_merged_contacts jsonb;
  v_profile_preferred_type text;
  v_account_first_name text;
  v_account_last_name text;
  v_order public.orders%rowtype;
  v_priority_order public.orders%rowtype;
  v_service_keys jsonb;
  v_service_key text;
  v_seen_keys text[] := '{}';
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_damage_raw jsonb;
  v_priority_cards jsonb;
  v_non_priority_cards jsonb;
  v_priority_count int;
  v_non_priority_count int;
  v_orders_out jsonb := '[]'::jsonb;
  v_split boolean := false;
  v_speed text;
  v_speeds text[];
  v_stay_speed text;
  v_part_id uuid;
  v_part_cards jsonb;
  v_part_order public.orders%rowtype;
  v_split_ids jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload is required';
  END IF;

  BEGIN
    v_order_id := (p_payload ->> 'id')::uuid;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'order id must be a valid uuid';
  END;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  v_user_id := auth.uid();

  v_first_name := trim(coalesce(p_payload ->> 'first_name', ''));
  IF v_first_name = '' THEN
    RAISE EXCEPTION 'first_name is required';
  END IF;

  v_last_name := trim(coalesce(p_payload ->> 'last_name', ''));
  IF v_last_name = '' THEN
    RAISE EXCEPTION 'last_name is required';
  END IF;

  v_customer_email := trim(coalesce(p_payload ->> 'customer_email', ''));
  IF v_customer_email = '' THEN
    RAISE EXCEPTION 'customer_email is required';
  END IF;

  -- If this email (or session) already belongs to an account with a saved
  -- name, that name wins over whatever was typed on this particular
  -- submission — logged in or anonymous with a matching email.
  v_account_user_id := v_user_id;
  IF v_account_user_id IS NULL THEN
    SELECT u.id INTO v_account_user_id
    FROM auth.users u
    WHERE lower(u.email) = lower(v_customer_email)
    LIMIT 1;
  END IF;

  IF v_account_user_id IS NOT NULL THEN
    SELECT first_name, last_name INTO v_account_first_name, v_account_last_name
    FROM public.customer_profiles
    WHERE user_id = v_account_user_id;

    IF coalesce(v_account_first_name, '') <> '' THEN
      v_first_name := v_account_first_name;
    END IF;
    IF coalesce(v_account_last_name, '') <> '' THEN
      v_last_name := v_account_last_name;
    END IF;
  END IF;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.customer_profiles (user_id, first_name, last_name, updated_at)
    VALUES (v_user_id, v_first_name, v_last_name, now())
    ON CONFLICT (user_id) DO UPDATE
    SET
      first_name = CASE
        WHEN coalesce(public.customer_profiles.first_name, '') = ''
          THEN excluded.first_name
        ELSE public.customer_profiles.first_name
      END,
      last_name = CASE
        WHEN coalesce(public.customer_profiles.last_name, '') = ''
          THEN excluded.last_name
        ELSE public.customer_profiles.last_name
      END,
      updated_at = now()
    WHERE
      coalesce(public.customer_profiles.first_name, '') = ''
      OR coalesce(public.customer_profiles.last_name, '') = '';
  END IF;

  v_customer_name := trim(v_first_name || ' ' || v_last_name);

  v_delivery_method := p_payload ->> 'delivery_method';
  IF v_delivery_method IS NULL
     OR v_delivery_method NOT IN ('local_dropoff', 'shipping') THEN
    RAISE EXCEPTION 'delivery_method must be local_dropoff or shipping';
  END IF;

  v_heard_about_source := nullif(trim(coalesce(p_payload ->> 'heard_about_source', '')), '');

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  IF jsonb_typeof(v_contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts must be an array';
  END IF;

  IF jsonb_array_length(v_contacts) < 1 THEN
    RAISE EXCEPTION 'at least one additional contact is required';
  END IF;

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  IF jsonb_typeof(v_cards) <> 'array' THEN
    RAISE EXCEPTION 'cards must be an array';
  END IF;

  v_card_count := jsonb_array_length(v_cards);
  IF v_card_count < 1 THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;

  FOR v_contact IN SELECT * FROM jsonb_array_elements(v_contacts)
  LOOP
    IF coalesce(v_contact ->> 'contact_type', '') NOT IN ('phone', 'discord', 'instagram') THEN
      RAISE EXCEPTION 'invalid contact_type';
    END IF;
    IF trim(coalesce(v_contact ->> 'value', '')) = '' THEN
      RAISE EXCEPTION 'contact value is required';
    END IF;
  END LOOP;

  v_preferred_type := coalesce(nullif(trim(coalesce(p_payload ->> 'preferred_contact_type', '')), ''), 'email');
  IF v_preferred_type NOT IN ('email', 'phone', 'discord', 'instagram') THEN
    RAISE EXCEPTION 'invalid preferred_contact_type';
  END IF;

  IF v_preferred_type = 'email' THEN
    v_preferred_value := v_customer_email;
  ELSE
    v_preferred_value := trim(coalesce(p_payload ->> 'preferred_contact_value', ''));
    IF v_preferred_value = '' THEN
      RAISE EXCEPTION 'preferred_contact_value is required';
    END IF;
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT
      coalesce(contacts, '[]'::jsonb),
      nullif(trim(coalesce(preferred_contact_type, '')), '')
      INTO v_profile_contacts, v_profile_preferred_type
    FROM public.customer_profiles
    WHERE user_id = v_user_id;

    v_profile_contacts := coalesce(v_profile_contacts, '[]'::jsonb);

    SELECT coalesce(jsonb_agg(p), '[]'::jsonb)
      INTO v_profile_contacts
    FROM jsonb_array_elements(v_profile_contacts) p
    WHERE trim(coalesce(p ->> 'value', '')) <> '';

    SELECT v_profile_contacts || coalesce(jsonb_agg(
             jsonb_build_object('contact_type', s.contact_type, 'value', s.value)
           ), '[]'::jsonb)
      INTO v_merged_contacts
    FROM (
      SELECT DISTINCT ON (e ->> 'contact_type')
             e ->> 'contact_type' AS contact_type,
             trim(e ->> 'value') AS value
      FROM jsonb_array_elements(v_contacts) e
      ORDER BY e ->> 'contact_type'
    ) s
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_profile_contacts) p
      WHERE p ->> 'contact_type' = s.contact_type
    );

    IF v_merged_contacts <> v_profile_contacts OR v_profile_preferred_type IS NULL THEN
      INSERT INTO public.customer_profiles (
        user_id, contacts, preferred_contact_type, preferred_contact_value, updated_at
      )
      VALUES (
        v_user_id, v_merged_contacts, v_preferred_type, v_preferred_value, now()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET
        contacts = excluded.contacts,
        preferred_contact_type = CASE
          WHEN coalesce(public.customer_profiles.preferred_contact_type, '') = ''
            THEN excluded.preferred_contact_type
          ELSE public.customer_profiles.preferred_contact_type
        END,
        preferred_contact_value = CASE
          WHEN coalesce(public.customer_profiles.preferred_contact_type, '') = ''
            THEN excluded.preferred_contact_value
          ELSE public.customer_profiles.preferred_contact_value
        END,
        updated_at = now();
    END IF;
  END IF;

  FOR v_card IN SELECT * FROM jsonb_array_elements(v_cards)
  LOOP
    BEGIN
      v_card_id := (v_card ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'card id must be a valid uuid';
    END;
    IF v_card_id IS NULL THEN
      RAISE EXCEPTION 'card id is required';
    END IF;

    v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
    IF v_card_name = '' THEN
      RAISE EXCEPTION 'card_name is required';
    END IF;

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    IF jsonb_typeof(v_images) <> 'array' THEN
      RAISE EXCEPTION 'card images must be an array';
    END IF;

    v_image_count := jsonb_array_length(v_images);
    IF v_image_count < 1 THEN
      RAISE EXCEPTION 'each card requires at least one image';
    END IF;

    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      IF trim(coalesce(v_image ->> 'storage_path', '')) = '' THEN
        RAISE EXCEPTION 'image storage_path is required';
      END IF;
      IF coalesce(v_image ->> 'image_type', 'customer') NOT IN ('customer', 'admin') THEN
        RAISE EXCEPTION 'invalid image_type';
      END IF;
    END LOOP;

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    IF v_card ? 'damage_tags' AND v_card -> 'damage_tags' IS NOT NULL THEN
      v_damage_raw := v_card -> 'damage_tags';
      IF jsonb_typeof(v_damage_raw) <> 'array' THEN
        RAISE EXCEPTION 'card damage_tags must be an array';
      END IF;
      FOR v_damage_tag IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_damage_raw)
      LOOP
        IF v_damage_tag = '' THEN
          CONTINUE;
        END IF;
        IF v_damage_tag = ANY (v_seen_damage) THEN
          CONTINUE;
        END IF;
        IF v_damage_tag NOT IN (
          'crease',
          'scratching',
          'dent',
          'edge_lift',
          'edge_peeling',
          'dirt',
          'water_damage',
          'warping',
          'whitening'
        ) THEN
          RAISE EXCEPTION 'invalid damage_tag: %', v_damage_tag;
        END IF;
        v_seen_damage := array_append(v_seen_damage, v_damage_tag);
        v_damage_tags := array_append(v_damage_tags, v_damage_tag);
      END LOOP;
    END IF;

    IF coalesce(array_length(v_damage_tags, 1), 0) < 1 THEN
      RAISE EXCEPTION 'each card requires at least one damage_tag';
    END IF;

    IF v_card ? 'service_keys' AND v_card -> 'service_keys' IS NOT NULL THEN
      v_service_keys := v_card -> 'service_keys';
      IF jsonb_typeof(v_service_keys) <> 'array' THEN
        RAISE EXCEPTION 'card service_keys must be an array';
      END IF;

      v_seen_keys := '{}';
      FOR v_service_key IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_service_keys)
      LOOP
        IF v_service_key = '' THEN
          CONTINUE;
        END IF;
        IF v_service_key = ANY (v_seen_keys) THEN
          CONTINUE;
        END IF;
        IF v_service_key NOT IN (
          'surface_restoration',
          'precision_pressing',
          'advanced_restoration',
          'card_whitening',
          'card_whitening_major',
          'slab_cracking'
        ) THEN
          RAISE EXCEPTION 'invalid service_key: %', v_service_key;
        END IF;
        v_seen_keys := array_append(v_seen_keys, v_service_key);
      END LOOP;
    END IF;
  END LOOP;


  SELECT coalesce(array_agg(speed ORDER BY public.queue_speed_rank(speed)), ARRAY['standard']::text[])
    INTO v_speeds
  FROM (
    SELECT DISTINCT public.normalize_queue_speed(
      c.elem ->> 'queue_speed',
      coalesce((c.elem ->> 'is_priority')::boolean, false)
    ) AS speed
    FROM jsonb_array_elements(v_cards) AS c(elem)
  ) s;

  v_stay_speed := v_speeds[1];
  v_split := coalesce(array_length(v_speeds, 1), 0) > 1;
  v_split_ids := coalesce(p_payload -> 'split_order_ids', '{}'::jsonb);
  IF jsonb_typeof(v_split_ids) <> 'object' THEN
    v_split_ids := '{}'::jsonb;
  END IF;
  IF v_split_ids ->> 'fast' IS NULL AND p_payload ? 'priority_order_id' THEN
    v_split_ids := jsonb_set(v_split_ids, '{fast}', to_jsonb(p_payload ->> 'priority_order_id'));
  END IF;
  IF v_split_ids ->> 'fast' IS NULL AND p_payload ? 'fast_order_id' THEN
    v_split_ids := jsonb_set(v_split_ids, '{fast}', to_jsonb(p_payload ->> 'fast_order_id'));
  END IF;
  IF v_split_ids ->> 'express' IS NULL AND p_payload ? 'express_order_id' THEN
    v_split_ids := jsonb_set(v_split_ids, '{express}', to_jsonb(p_payload ->> 'express_order_id'));
  END IF;

  v_orders_out := '[]'::jsonb;
  FOREACH v_speed IN ARRAY v_speeds
  LOOP
    SELECT coalesce(jsonb_agg(c.elem ORDER BY c.ord), '[]'::jsonb)
      INTO v_part_cards
    FROM jsonb_array_elements(v_cards) WITH ORDINALITY AS c(elem, ord)
    WHERE public.normalize_queue_speed(
      c.elem ->> 'queue_speed',
      coalesce((c.elem ->> 'is_priority')::boolean, false)
    ) = v_speed;

    IF v_speed = v_stay_speed THEN
      v_part_id := v_order_id;
    ELSE
      BEGIN
        v_part_id := nullif(trim(coalesce(v_split_ids ->> v_speed, '')), '')::uuid;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'split_order_ids.% must be a valid uuid', v_speed;
      END;
      IF v_part_id IS NULL THEN
        RAISE EXCEPTION 'split_order_ids.% is required when cards mix queue speeds', v_speed;
      END IF;
      IF v_part_id = v_order_id THEN
        RAISE EXCEPTION 'split_order_ids.% must differ from order id', v_speed;
      END IF;
    END IF;

    v_part_order := public._create_order_partition(
      v_part_id,
      v_user_id,
      v_first_name,
      v_last_name,
      v_customer_name,
      v_customer_email,
      v_delivery_method,
      v_heard_about_source,
      v_preferred_type,
      v_preferred_value,
      v_speed IS DISTINCT FROM 'standard',
      v_contacts,
      v_part_cards
    );

    IF v_speed = v_stay_speed THEN
      v_order := v_part_order;
    END IF;

    v_orders_out := v_orders_out || jsonb_build_array(
      jsonb_build_object(
        'id', v_part_order.id,
        'display_id', v_part_order.display_id,
        'is_priority', v_part_order.is_priority,
        'queue_speed', v_speed
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'is_priority', v_order.is_priority,
    'queue_speed', v_order.queue_speed,
    'split', v_split,
    'orders', v_orders_out
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_card_priorities_and_split(
  p_order_id uuid,
  p_cards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_card jsonb;
  v_card_id uuid;
  v_speed text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF p_cards IS NULL OR jsonb_typeof(p_cards) <> 'array' THEN
    RAISE EXCEPTION 'cards must be an array';
  END IF;

  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    IF nullif(trim(coalesce(v_card ->> 'id', '')), '') IS NULL THEN
      CONTINUE;
    END IF;

    BEGIN
      v_card_id := (v_card ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'card id must be a valid uuid';
    END;

    IF NOT (v_card ? 'queue_speed') AND NOT (v_card ? 'is_priority') THEN
      CONTINUE;
    END IF;

    v_speed := public.normalize_queue_speed(
      v_card ->> 'queue_speed',
      coalesce((v_card ->> 'is_priority')::boolean, false)
    );

    UPDATE public.cards
    SET queue_speed = v_speed
    WHERE id = v_card_id
      AND order_id = p_order_id;
  END LOOP;

  RETURN public.split_mixed_priority_order(p_order_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public._split_off_queue_speed(p_order_id uuid, p_speed text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source public.orders%rowtype;
  v_new public.orders%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_speed text;
  v_moved_ids uuid[];
  v_contact public.contacts%rowtype;
  v_bulk jsonb;
  v_adjustments jsonb;
  v_without jsonb;
  v_card_hv jsonb;
  v_stay_hv jsonb;
  v_move_hv jsonb;
  v_stay_bulk jsonb;
  v_move_bulk jsonb;
BEGIN
  v_speed := public.normalize_queue_speed(p_speed, false);
  IF v_speed = 'standard' THEN
    RAISE EXCEPTION 'cannot split standard cards off an order';
  END IF;

  SELECT * INTO v_source
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  SELECT coalesce(array_agg(c.id), '{}'::uuid[])
  INTO v_moved_ids
  FROM public.cards c
  WHERE c.order_id = p_order_id
    AND c.queue_speed = v_speed;

  IF coalesce(array_length(v_moved_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'queue split found no % cards', v_speed;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cards c
    WHERE c.order_id = p_order_id
      AND c.queue_speed IS DISTINCT FROM v_speed
  ) THEN
    RAISE EXCEPTION 'queue split would leave original order empty';
  END IF;

  INSERT INTO public.orders (
    id, user_id, first_name, last_name, customer_name, customer_email, delivery_method,
    general_notes, heard_about_source, preferred_contact_type, preferred_contact_value,
    status, pending_kind, photos_drive_url, quote_override_label, quote_override_amount,
    after_completion_amounts, restoration_costs, status_changed_at, todo_entered_at,
    queue_speed, quote_bulk_counts
  )
  SELECT
    v_new_id, s.user_id, s.first_name, s.last_name, s.customer_name, s.customer_email,
    s.delivery_method, s.general_notes, s.heard_about_source, s.preferred_contact_type,
    s.preferred_contact_value, s.status, s.pending_kind, s.photos_drive_url,
    s.quote_override_label, s.quote_override_amount, s.after_completion_amounts,
    s.restoration_costs, s.status_changed_at, s.todo_entered_at, v_speed, null
  FROM public.orders s
  WHERE s.id = p_order_id
  RETURNING * INTO v_new;

  INSERT INTO public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes
  )
  VALUES (
    v_new.id, v_new.display_id, v_new.created_at, v_new.first_name, v_new.last_name,
    v_new.customer_name, v_new.delivery_method, v_new.general_notes
  );

  FOR v_contact IN SELECT * FROM public.contacts WHERE order_id = p_order_id
  LOOP
    INSERT INTO public.contacts (order_id, contact_type, value)
    VALUES (v_new_id, v_contact.contact_type, v_contact.value);
  END LOOP;

  UPDATE public.cards SET order_id = v_new_id WHERE id = ANY (v_moved_ids);
  UPDATE public.cards_original SET order_id = v_new_id WHERE id = ANY (v_moved_ids);

  UPDATE public.order_quote_items qi
  SET order_id = v_new_id
  WHERE qi.order_id = p_order_id
    AND (
      qi.card_id = ANY (v_moved_ids)
      OR (
        qi.card_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.cards c
          WHERE c.id = ANY (v_moved_ids)
            AND lower(trim(c.card_name)) = lower(trim(qi.card_name))
            AND lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
        )
      )
    );

  v_bulk := v_source.quote_bulk_counts;
  IF v_bulk IS NULL OR jsonb_typeof(v_bulk) <> 'object' THEN
    v_adjustments := '[]'::jsonb;
    v_card_hv := '[]'::jsonb;
  ELSE
    v_adjustments := coalesce(v_bulk -> 'adjustments', '[]'::jsonb);
    IF jsonb_typeof(v_adjustments) <> 'array' THEN
      v_adjustments := '[]'::jsonb;
    END IF;
    IF jsonb_typeof(v_bulk -> 'card_hv') = 'array' THEN
      v_card_hv := v_bulk -> 'card_hv';
    ELSE
      v_card_hv := '[]'::jsonb;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_without
  FROM jsonb_array_elements(v_adjustments) elem
  WHERE NOT public.is_queue_speed_adjustment_label(elem ->> 'description');

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_stay_hv
  FROM jsonb_array_elements(v_card_hv) elem
  WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
    AND NOT (elem ->> 'card_id' = ANY (SELECT mid::text FROM unnest(v_moved_ids) mid));

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_move_hv
  FROM jsonb_array_elements(v_card_hv) elem
  WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
    AND elem ->> 'card_id' = ANY (SELECT mid::text FROM unnest(v_moved_ids) mid);

  IF jsonb_array_length(v_without) = 0 AND jsonb_array_length(v_stay_hv) = 0 THEN
    v_stay_bulk := null;
  ELSE
    v_stay_bulk := jsonb_build_object('version', 2);
    IF jsonb_array_length(v_without) > 0 THEN
      v_stay_bulk := jsonb_set(v_stay_bulk, '{adjustments}', v_without, true);
    END IF;
    IF jsonb_array_length(v_stay_hv) > 0 THEN
      v_stay_bulk := jsonb_set(v_stay_bulk, '{card_hv}', v_stay_hv, true);
    END IF;
  END IF;

  IF jsonb_array_length(v_move_hv) = 0 THEN
    v_move_bulk := null;
  ELSE
    v_move_bulk := jsonb_build_object('version', 2, 'card_hv', v_move_hv);
  END IF;

  UPDATE public.orders SET quote_bulk_counts = v_stay_bulk WHERE id = p_order_id;
  UPDATE public.orders SET quote_bulk_counts = v_move_bulk WHERE id = v_new_id;

  PERFORM public.sync_order_priority_quote_adjustment(p_order_id);
  PERFORM public.sync_order_priority_quote_adjustment(v_new_id);

  SELECT * INTO v_new FROM public.orders WHERE id = v_new_id;

  RETURN jsonb_build_object(
    'id', v_new.id,
    'display_id', v_new.display_id,
    'queue_speed', v_new.queue_speed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.split_mixed_priority_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source public.orders%rowtype;
  v_speeds text[];
  v_stay text;
  v_speed text;
  v_new jsonb;
  v_new_orders jsonb := '[]'::jsonb;
  v_reconcile text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  SELECT * INTO v_source
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  SELECT coalesce(array_agg(speed ORDER BY public.queue_speed_rank(speed)), '{}')
  INTO v_speeds
  FROM (
    SELECT DISTINCT c.queue_speed AS speed
    FROM public.cards c
    WHERE c.order_id = p_order_id
  ) s;

  IF coalesce(array_length(v_speeds, 1), 0) <= 1 THEN
    SELECT coalesce(
      (
        SELECT c.queue_speed
        FROM public.cards c
        WHERE c.order_id = p_order_id
          AND c.status IS DISTINCT FROM 'canceled'
        ORDER BY public.queue_speed_rank(c.queue_speed) DESC
        LIMIT 1
      ),
      (
        SELECT c.queue_speed
        FROM public.cards c
        WHERE c.order_id = p_order_id
        ORDER BY public.queue_speed_rank(c.queue_speed) DESC
        LIMIT 1
      ),
      'standard'
    )
    INTO v_reconcile;

    UPDATE public.orders
    SET queue_speed = v_reconcile
    WHERE id = p_order_id
      AND queue_speed IS DISTINCT FROM v_reconcile;

    PERFORM public.sync_order_priority_quote_adjustment(p_order_id);

    RETURN jsonb_build_object('split', false, 'id', p_order_id);
  END IF;

  v_stay := v_speeds[1];

  FOREACH v_speed IN ARRAY v_speeds
  LOOP
    IF v_speed = v_stay THEN
      CONTINUE;
    END IF;
    v_new := public._split_off_queue_speed(p_order_id, v_speed);
    v_new_orders := v_new_orders || jsonb_build_array(v_new);
  END LOOP;

  UPDATE public.orders
  SET queue_speed = v_stay
  WHERE id = p_order_id
    AND queue_speed IS DISTINCT FROM v_stay;

  PERFORM public.sync_order_priority_quote_adjustment(p_order_id);

  SELECT * INTO v_source FROM public.orders WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'split', true,
    'id', v_source.id,
    'display_id', v_source.display_id,
    'queue_speed', v_source.queue_speed,
    'new_orders', v_new_orders,
    'new_order_id', v_new_orders -> 0 ->> 'id',
    'new_display_id', (v_new_orders -> 0 ->> 'display_id')::bigint
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_order(p_order_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_before jsonb;
  v_delivery_method text;
  v_preferred_type text;
  v_preferred_value text;
  v_card_is_priority boolean;
  v_card_queue_speed text;
  v_contacts jsonb;
  v_cards jsonb;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_card_id uuid;
  v_card_name text;
  v_set_name text;
  v_description text;
  v_images jsonb;
  v_card_count int;
  v_image_count int;
  v_customer_image_count int;
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_damage_raw jsonb;
  v_kept_card_ids uuid[] := '{}';
  v_kept_image_ids bigint[] := '{}';
  v_sort_order int := 0;
  v_existing_card public.cards%rowtype;
  v_image_id bigint;
  v_storage_path text;
  v_path_prefix text;
  v_order_changes jsonb := '[]'::jsonb;
  v_card_groups jsonb := '[]'::jsonb;
  v_changelog jsonb;
  v_label text;
  v_before_card jsonb;
  v_after_card jsonb;
  v_after jsonb;
  v_card_changes text[];
  v_before_contacts text;
  v_after_contacts text;
  v_split jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload is required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or access denied';
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'order can only be edited while pending';
  END IF;

  v_before := public.get_my_order(p_order_id);

  v_delivery_method := coalesce(
    p_payload ->> 'delivery_method',
    v_order.delivery_method
  );
  IF v_delivery_method NOT IN ('local_dropoff', 'shipping') THEN
    RAISE EXCEPTION 'delivery_method must be local_dropoff or shipping';
  END IF;

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  IF jsonb_typeof(v_contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts must be an array';
  END IF;
  IF jsonb_array_length(v_contacts) < 1 THEN
    RAISE EXCEPTION 'at least one additional contact is required';
  END IF;

  FOR v_contact IN SELECT * FROM jsonb_array_elements(v_contacts)
  LOOP
    IF coalesce(v_contact ->> 'contact_type', '') NOT IN ('phone', 'discord', 'instagram') THEN
      RAISE EXCEPTION 'invalid contact_type';
    END IF;
    IF trim(coalesce(v_contact ->> 'value', '')) = '' THEN
      RAISE EXCEPTION 'contact value is required';
    END IF;
  END LOOP;

  v_preferred_type := coalesce(
    nullif(trim(coalesce(p_payload ->> 'preferred_contact_type', '')), ''),
    coalesce(v_order.preferred_contact_type, 'email')
  );
  IF v_preferred_type NOT IN ('email', 'phone', 'discord', 'instagram') THEN
    RAISE EXCEPTION 'invalid preferred_contact_type';
  END IF;

  IF v_preferred_type = 'email' THEN
    v_preferred_value := v_order.customer_email;
  ELSE
    v_preferred_value := trim(coalesce(p_payload ->> 'preferred_contact_value', ''));
    IF v_preferred_value = '' THEN
      SELECT trim(c ->> 'value') INTO v_preferred_value
      FROM jsonb_array_elements(v_contacts) c
      WHERE c ->> 'contact_type' = v_preferred_type
        AND trim(coalesce(c ->> 'value', '')) <> ''
      LIMIT 1;
    END IF;
    IF coalesce(v_preferred_value, '') = '' THEN
      RAISE EXCEPTION 'preferred_contact_value is required';
    END IF;
  END IF;

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  IF jsonb_typeof(v_cards) <> 'array' THEN
    RAISE EXCEPTION 'cards must be an array';
  END IF;

  v_card_count := jsonb_array_length(v_cards);
  IF v_card_count < 1 THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;
  IF v_card_count > 25 THEN
    RAISE EXCEPTION 'at most 25 cards allowed';
  END IF;

  -- Validate all cards before mutating.
  FOR v_card IN SELECT * FROM jsonb_array_elements(v_cards)
  LOOP
    BEGIN
      v_card_id := (v_card ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'card id must be a valid uuid';
    END;
    IF v_card_id IS NULL THEN
      RAISE EXCEPTION 'card id is required';
    END IF;

    v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
    IF v_card_name = '' THEN
      RAISE EXCEPTION 'card_name is required';
    END IF;

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    IF jsonb_typeof(v_images) <> 'array' THEN
      RAISE EXCEPTION 'card images must be an array';
    END IF;

    v_image_count := jsonb_array_length(v_images);
    IF v_image_count < 1 THEN
      RAISE EXCEPTION 'each card requires at least one image';
    END IF;
    IF v_image_count > 4 THEN
      RAISE EXCEPTION 'each card allows at most 4 customer images';
    END IF;

    v_path_prefix := 'order-' || p_order_id::text || '/card-' || v_card_id::text || '/';
    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      v_storage_path := trim(coalesce(v_image ->> 'storage_path', ''));
      IF v_storage_path = '' THEN
        RAISE EXCEPTION 'image storage_path is required';
      END IF;
      IF position(v_path_prefix IN v_storage_path) <> 1 THEN
        RAISE EXCEPTION 'image storage_path must belong to this order card';
      END IF;
    END LOOP;

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    IF v_card ? 'damage_tags' AND v_card -> 'damage_tags' IS NOT NULL THEN
      v_damage_raw := v_card -> 'damage_tags';
      IF jsonb_typeof(v_damage_raw) <> 'array' THEN
        RAISE EXCEPTION 'card damage_tags must be an array';
      END IF;
      FOR v_damage_tag IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_damage_raw)
      LOOP
        IF v_damage_tag = '' THEN
          CONTINUE;
        END IF;
        IF v_damage_tag = ANY (v_seen_damage) THEN
          CONTINUE;
        END IF;
        IF v_damage_tag NOT IN (
          'crease',
          'scratching',
          'dent',
          'edge_lift',
          'edge_peeling',
          'dirt',
          'water_damage',
          'warping',
          'whitening'
        ) THEN
          RAISE EXCEPTION 'invalid damage_tag: %', v_damage_tag;
        END IF;
        v_seen_damage := array_append(v_seen_damage, v_damage_tag);
        v_damage_tags := array_append(v_damage_tags, v_damage_tag);
      END LOOP;
    END IF;

    IF coalesce(array_length(v_damage_tags, 1), 0) < 1 THEN
      RAISE EXCEPTION 'each card requires at least one damage_tag';
    END IF;
  END LOOP;

  -- Order-level fields (never touch quote columns; do not write order is_priority).
  UPDATE public.orders
  SET
    delivery_method = v_delivery_method,
    preferred_contact_type = v_preferred_type,
    preferred_contact_value = v_preferred_value
  WHERE id = p_order_id;

  -- Replace contacts.
  DELETE FROM public.contacts WHERE order_id = p_order_id;
  FOR v_contact IN SELECT * FROM jsonb_array_elements(v_contacts)
  LOOP
    INSERT INTO public.contacts (order_id, contact_type, value)
    VALUES (
      p_order_id,
      v_contact ->> 'contact_type',
      trim(v_contact ->> 'value')
    );
  END LOOP;

  -- Sync cards (including per-card is_priority).
  v_sort_order := 0;
  FOR v_card IN SELECT * FROM jsonb_array_elements(v_cards)
  LOOP
    v_card_id := (v_card ->> 'id')::uuid;
    v_card_name := trim(v_card ->> 'card_name');
    v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');
    v_description := nullif(trim(coalesce(v_card ->> 'description', '')), '');
    v_card_queue_speed := public.normalize_queue_speed(
      v_card ->> 'queue_speed',
      coalesce((v_card ->> 'is_priority')::boolean, false)
    );
    v_card_is_priority := v_card_queue_speed IS DISTINCT FROM 'standard';

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    FOR v_damage_tag IN
      SELECT trim(value)
      FROM jsonb_array_elements_text(coalesce(v_card -> 'damage_tags', '[]'::jsonb))
    LOOP
      IF v_damage_tag = '' THEN
        CONTINUE;
      END IF;
      IF v_damage_tag = ANY (v_seen_damage) THEN
        CONTINUE;
      END IF;
      IF v_damage_tag NOT IN (
        'crease',
        'scratching',
        'dent',
        'edge_lift',
        'edge_peeling',
        'dirt',
        'water_damage',
        'warping',
        'whitening'
      ) THEN
        RAISE EXCEPTION 'invalid damage_tag: %', v_damage_tag;
      END IF;
      v_seen_damage := array_append(v_seen_damage, v_damage_tag);
      v_damage_tags := array_append(v_damage_tags, v_damage_tag);
    END LOOP;

    SELECT * INTO v_existing_card
    FROM public.cards
    WHERE id = v_card_id AND order_id = p_order_id;

    IF FOUND THEN
      UPDATE public.cards
      SET
        card_name = v_card_name,
        set_name = v_set_name,
        description = v_description,
        damage_tags = v_damage_tags,
        sort_order = v_sort_order,
        queue_speed = v_card_queue_speed
      WHERE id = v_card_id;
    ELSE
      INSERT INTO public.cards (
        id, order_id, card_name, set_name, description, damage_tags, sort_order, queue_speed
      )
      VALUES (
        v_card_id,
        p_order_id,
        v_card_name,
        v_set_name,
        v_description,
        v_damage_tags,
        v_sort_order,
        v_card_queue_speed
      );
    END IF;

    v_kept_card_ids := array_append(v_kept_card_ids, v_card_id);

    -- Sync customer images only.
    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    v_kept_image_ids := '{}';
    v_customer_image_count := 0;

    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      v_storage_path := trim(v_image ->> 'storage_path');
      v_image_id := null;
      IF v_image ? 'id' AND nullif(trim(coalesce(v_image ->> 'id', '')), '') IS NOT NULL THEN
        BEGIN
          v_image_id := (v_image ->> 'id')::bigint;
        EXCEPTION
          WHEN others THEN
            v_image_id := null;
        END;
      END IF;

      IF v_image_id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1
          FROM public.card_images ci
          WHERE ci.id = v_image_id
            AND ci.card_id = v_card_id
            AND ci.image_type = 'customer'
        ) THEN
          UPDATE public.card_images
          SET storage_path = v_storage_path
          WHERE id = v_image_id;
          v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
          v_customer_image_count := v_customer_image_count + 1;
          CONTINUE;
        END IF;
      END IF;

      SELECT ci.id INTO v_image_id
      FROM public.card_images ci
      WHERE ci.card_id = v_card_id
        AND ci.image_type = 'customer'
        AND ci.storage_path = v_storage_path
      LIMIT 1;

      IF v_image_id IS NOT NULL THEN
        v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
        v_customer_image_count := v_customer_image_count + 1;
      ELSE
        INSERT INTO public.card_images (card_id, image_type, storage_path)
        VALUES (v_card_id, 'customer', v_storage_path)
        RETURNING id INTO v_image_id;
        v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
        v_customer_image_count := v_customer_image_count + 1;
      END IF;
    END LOOP;

    IF v_customer_image_count < 1 THEN
      RAISE EXCEPTION 'each card requires at least one customer image';
    END IF;

    DELETE FROM public.card_images ci
    WHERE ci.card_id = v_card_id
      AND ci.image_type = 'customer'
      AND NOT (ci.id = ANY (v_kept_image_ids));

    v_sort_order := v_sort_order + 1;
  END LOOP;

  DELETE FROM public.cards
  WHERE order_id = p_order_id
    AND NOT (id = ANY (v_kept_card_ids));

  -- card_id rows cascade on card delete; clear legacy name/set orphans only.
  DELETE FROM public.order_quote_items qi
  WHERE qi.order_id = p_order_id
    AND qi.card_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.cards c
      WHERE c.order_id = p_order_id
        AND lower(trim(c.card_name)) = lower(trim(qi.card_name))
        AND lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
    );

  UPDATE public.orders o
  SET quote_bulk_counts = CASE
    WHEN o.quote_bulk_counts IS NULL THEN null
    WHEN jsonb_typeof(o.quote_bulk_counts -> 'card_hv') IS DISTINCT FROM 'array' THEN o.quote_bulk_counts
    ELSE (
      SELECT CASE
        WHEN jsonb_array_length(coalesce(o.quote_bulk_counts -> 'adjustments', '[]'::jsonb)) = 0
             AND coalesce(jsonb_array_length(filtered.hv), 0) = 0 THEN null
        WHEN coalesce(jsonb_array_length(filtered.hv), 0) = 0 THEN
          o.quote_bulk_counts - 'card_hv'
        ELSE
          jsonb_set(o.quote_bulk_counts, '{card_hv}', filtered.hv)
      END
      FROM (
        SELECT coalesce(
          (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(o.quote_bulk_counts -> 'card_hv') elem
            WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
              AND elem ->> 'card_id' = ANY (
                SELECT kid::text FROM unnest(v_kept_card_ids) kid
              )
          ),
          '[]'::jsonb
        ) AS hv
      ) filtered
    )
  END
  WHERE o.id = p_order_id;

  -- Auto-split if cards are now mixed priority; reconcile fee otherwise.
  v_split := public.split_mixed_priority_order(p_order_id);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  v_after := public.get_my_order(p_order_id);

  -- Build a customer-facing changelog for admin visibility.
  IF coalesce(v_before ->> 'delivery_method', '') IS DISTINCT FROM v_order.delivery_method THEN
    v_order_changes := v_order_changes || jsonb_build_array(
      format(
        'Delivery: %s → %s',
        CASE coalesce(v_before ->> 'delivery_method', '')
          WHEN 'local_dropoff' THEN 'Local Drop-Off'
          WHEN 'shipping' THEN 'Shipping'
          ELSE coalesce(v_before ->> 'delivery_method', '—')
        END,
        CASE v_order.delivery_method
          WHEN 'local_dropoff' THEN 'Local Drop-Off'
          WHEN 'shipping' THEN 'Shipping'
          ELSE v_order.delivery_method
        END
      )
    );
  END IF;

  IF coalesce(v_before ->> 'queue_speed', 'standard') IS DISTINCT FROM coalesce(v_order.queue_speed, 'standard') THEN
    v_order_changes := v_order_changes || jsonb_build_array(
      format(
        'Queue: %s → %s',
        initcap(coalesce(v_before ->> 'queue_speed', 'standard')),
        initcap(coalesce(v_order.queue_speed, 'standard'))
      )
    );
  END IF;

  IF coalesce((v_split ->> 'split')::boolean, false) THEN
    v_order_changes := v_order_changes || jsonb_build_array(
      format(
        'Split into separate queue order #%s',
        coalesce(v_split ->> 'new_display_id', v_split ->> 'new_order_id')
      )
    );
  END IF;

  SELECT string_agg(contact_type || ':' || value, ',' ORDER BY contact_type, value)
    INTO v_before_contacts
  FROM jsonb_to_recordset(coalesce(v_before -> 'contacts', '[]'::jsonb))
    AS x(contact_type text, value text);

  SELECT string_agg(contact_type || ':' || value, ',' ORDER BY contact_type, value)
    INTO v_after_contacts
  FROM public.contacts
  WHERE order_id = p_order_id;

  IF coalesce(v_before_contacts, '') IS DISTINCT FROM coalesce(v_after_contacts, '') THEN
    v_order_changes := v_order_changes || jsonb_build_array('Updated contacts');
  END IF;

  IF coalesce(v_before ->> 'preferred_contact_type', '') IS DISTINCT FROM coalesce(v_order.preferred_contact_type, '')
     OR coalesce(v_before ->> 'preferred_contact_value', '') IS DISTINCT FROM coalesce(v_order.preferred_contact_value, '') THEN
    v_order_changes := v_order_changes || jsonb_build_array('Updated preferred contact');
  END IF;

  FOR v_before_card IN
    SELECT value
    FROM jsonb_array_elements(coalesce(v_before -> 'cards', '[]'::jsonb))
  LOOP
    -- Missing from after = deleted or moved off this order by priority split.
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(v_after -> 'cards', '[]'::jsonb)) a
      WHERE a ->> 'id' = v_before_card ->> 'id'
    ) THEN
      v_label := trim(coalesce(v_before_card ->> 'card_name', 'Card'));
      IF nullif(trim(coalesce(v_before_card ->> 'set_name', '')), '') IS NOT NULL THEN
        v_label := v_label || ' (' || trim(v_before_card ->> 'set_name') || ')';
      END IF;
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_before_card ->> 'id',
          'label', v_label,
          'status', 'removed',
          'sortIndex', 1000,
          'changes', '[]'::jsonb
        )
      );
    END IF;
  END LOOP;

  FOR v_after_card IN
    SELECT value
    FROM jsonb_array_elements(coalesce(v_after -> 'cards', '[]'::jsonb))
  LOOP
    v_before_card := null;
    SELECT value INTO v_before_card
    FROM jsonb_array_elements(coalesce(v_before -> 'cards', '[]'::jsonb)) value
    WHERE value ->> 'id' = v_after_card ->> 'id'
    LIMIT 1;

    v_label := trim(coalesce(v_after_card ->> 'card_name', 'Card'));
    IF nullif(trim(coalesce(v_after_card ->> 'set_name', '')), '') IS NOT NULL THEN
      v_label := v_label || ' (' || trim(v_after_card ->> 'set_name') || ')';
    END IF;

    IF v_before_card IS NULL THEN
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_after_card ->> 'id',
          'label', v_label,
          'status', 'added',
          'sortIndex', 0,
          'changes', '[]'::jsonb
        )
      );
      CONTINUE;
    END IF;

    v_card_changes := '{}';
    IF coalesce(v_before_card ->> 'card_name', '') IS DISTINCT FROM coalesce(v_after_card ->> 'card_name', '') THEN
      v_card_changes := array_append(
        v_card_changes,
        format('Name: %s → %s', coalesce(v_before_card ->> 'card_name', '—'), coalesce(v_after_card ->> 'card_name', '—'))
      );
    END IF;
    IF coalesce(v_before_card ->> 'set_name', '') IS DISTINCT FROM coalesce(v_after_card ->> 'set_name', '') THEN
      v_card_changes := array_append(
        v_card_changes,
        format('Set: %s → %s', coalesce(nullif(v_before_card ->> 'set_name', ''), '—'), coalesce(nullif(v_after_card ->> 'set_name', ''), '—'))
      );
    END IF;
    IF coalesce(v_before_card ->> 'description', '') IS DISTINCT FROM coalesce(v_after_card ->> 'description', '') THEN
      v_card_changes := array_append(v_card_changes, 'Updated description');
    END IF;
    IF coalesce(v_before_card -> 'damage_tags', '[]'::jsonb) IS DISTINCT FROM coalesce(v_after_card -> 'damage_tags', '[]'::jsonb) THEN
      v_card_changes := array_append(v_card_changes, 'Updated damage tags');
    END IF;
    IF coalesce(v_before_card ->> 'queue_speed', 'standard')
         IS DISTINCT FROM coalesce(v_after_card ->> 'queue_speed', 'standard') THEN
      v_card_changes := array_append(
        v_card_changes,
        format(
          'Queue: %s → %s',
          initcap(coalesce(v_before_card ->> 'queue_speed', 'standard')),
          initcap(coalesce(v_after_card ->> 'queue_speed', 'standard'))
        )
      );
    END IF;
    IF (
      SELECT coalesce(jsonb_agg(i ->> 'storage_path' ORDER BY i ->> 'storage_path'), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_before_card -> 'images', '[]'::jsonb)) i
      WHERE coalesce(i ->> 'image_type', 'customer') = 'customer'
    ) IS DISTINCT FROM (
      SELECT coalesce(jsonb_agg(i ->> 'storage_path' ORDER BY i ->> 'storage_path'), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_after_card -> 'images', '[]'::jsonb)) i
      WHERE coalesce(i ->> 'image_type', 'customer') = 'customer'
    ) THEN
      v_card_changes := array_append(v_card_changes, 'Updated photos');
    END IF;

    IF coalesce(array_length(v_card_changes, 1), 0) > 0 THEN
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_after_card ->> 'id',
          'label', v_label,
          'status', 'modified',
          'sortIndex', 100,
          'changes', to_jsonb(v_card_changes)
        )
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_order_changes) > 0 OR jsonb_array_length(v_card_groups) > 0 THEN
    v_changelog := jsonb_build_object(
      'cardGroups', v_card_groups,
      'orderChanges', v_order_changes,
      'quoteSummary', null
    );

    PERFORM public._insert_customer_order_message(
      v_order,
      'Customer updated order #' || v_order.display_id::text,
      'The customer updated this order while it was still pending.',
      v_changelog
    );
  END IF;

  RETURN v_after || jsonb_build_object(
    'split', coalesce((v_split ->> 'split')::boolean, false),
    'split_result', v_split
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_contacts jsonb;
  v_cards jsonb;
  v_quote_items jsonb;
  v_queue_position integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or access denied';
  END IF;

  IF v_order.status = 'new' THEN
    v_queue_position := public.todo_queue_position(v_order.id);
  ELSE
    v_queue_position := null;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'contact_type', c.contact_type,
      'value', c.value
    )
    ORDER BY c.id
  ) INTO v_contacts
  FROM public.contacts c
  WHERE c.order_id = v_order.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', card.id,
      'card_name', card.card_name,
      'set_name', card.set_name,
      'description', card.description,
      'damage_tags', coalesce(card.damage_tags, '{}'::text[]),
      'admin_note', card.admin_note,
      'status', card.status,
      'is_priority', card.is_priority,
      'queue_speed', card.queue_speed,
      'images', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ci.id,
            'image_type', ci.image_type,
            'storage_path', ci.storage_path
          )
          ORDER BY ci.id
        )
        FROM public.card_images ci
        WHERE ci.card_id = card.id
      )
    )
    ORDER BY card.sort_order, card.id
  ) INTO v_cards
  FROM public.cards card
  WHERE card.order_id = v_order.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', qi.id,
      'sort_order', qi.sort_order,
      'card_id', qi.card_id,
      'card_name', qi.card_name,
      'set_name', qi.set_name,
      'service_key', qi.service_key,
      'service_label', qi.service_label,
      'quote_base_amount', qi.quote_base_amount,
      'high_value_surcharge', qi.high_value_surcharge
    )
    ORDER BY qi.sort_order, qi.id
  ) INTO v_quote_items
  FROM public.order_quote_items qi
  WHERE qi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'customer_email', v_order.customer_email,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes,
    'photos_drive_url', v_order.photos_drive_url,
    'preferred_contact_type', v_order.preferred_contact_type,
    'preferred_contact_value', v_order.preferred_contact_value,
    'quote_bulk_counts', v_order.quote_bulk_counts,
    'quote_override_label', v_order.quote_override_label,
    'quote_override_amount', v_order.quote_override_amount,
    'is_priority', v_order.is_priority,
    'queue_speed', v_order.queue_speed,
    'status', v_order.status,
    'pending_kind', v_order.pending_kind,
    'queue_position', v_queue_position,
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_orders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_orders jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'display_id', o.display_id,
      'created_at', o.created_at,
      'customer_name', o.customer_name,
      'delivery_method', o.delivery_method,
      'status', o.status,
      'pending_kind', o.pending_kind,
      'is_priority', o.is_priority,
      'queue_speed', o.queue_speed,
      'completed_at', o.completed_at,
      'status_changed_at', o.status_changed_at,
      'todo_entered_at', o.todo_entered_at,
      'card_count', (
        select count(*)
        from public.cards c
        where c.order_id = o.id
      ),
      'queue_position', (
        case
          when o.status = 'new' then public.todo_queue_position(o.id)
          else null
        end
      ),
      'has_unread_messages', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'has_new_updates', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'has_admin_photos', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'preview_paths', (
        select coalesce(jsonb_agg(t.storage_path order by t.rn), '[]'::jsonb)
        from (
          select ci.storage_path,
                 row_number() over (order by c.sort_order, c.id, ci.id) as rn
          from public.cards c
          join public.card_images ci on ci.card_id = c.id
          where c.order_id = o.id and ci.image_type = 'customer'
        ) t
        where t.rn <= 4
      ),
      'image_count', (
        select count(*)
        from public.cards c
        join public.card_images ci on ci.card_id = c.id
        where c.order_id = o.id and ci.image_type = 'customer'
      )
    )
    order by o.created_at desc
  ) into v_orders
  from public.orders o
  where o.user_id = v_user_id;

  return coalesce(v_orders, '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_order(p_order_id uuid, p_order jsonb DEFAULT NULL::jsonb, p_contacts jsonb DEFAULT NULL::jsonb, p_cards jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_quote_item jsonb;
  v_quote_items jsonb;
  v_contact_id bigint;
  v_card_id uuid;
  v_quote_id uuid;
  v_quote_card_id uuid;
  v_images jsonb;
  v_contact_type text;
  v_value text;
  v_card_name text;
  v_set_name text;
  v_description text;
  v_admin_note text;
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_damage_raw jsonb;
  v_market_value numeric(10, 2);
  v_card_status text;
  v_prev_card_status text;
  v_card_status_changed boolean := false;
  v_status text;
  v_prev_status text;
  v_pending_kind text;
  v_image_type text;
  v_drive_url text;
  v_override_label text;
  v_override_amount numeric(10, 2);
  v_bulk_counts jsonb;
  v_service_key text;
  v_service_label text;
  v_base_amount numeric(10, 2);
  v_hv_surcharge numeric(10, 2);
  v_sort_order int;
  v_card_sort int;
  v_kept_card_ids uuid[] := '{}';
  v_order_status_manually_set boolean := false;
  v_allowed_image_types text[] := array[
    'customer', 'admin',
    'progress_front', 'progress_back',
    'final_front', 'final_back'
  ];
begin
  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  v_prev_status := v_order.status;

  if p_order is not null and jsonb_typeof(p_order) = 'object' then
    if p_order ? 'customer_name' then
      v_card_name := trim(coalesce(p_order ->> 'customer_name', ''));
      if v_card_name = '' then
        raise exception 'customer_name cannot be empty';
      end if;
      update public.orders
      set customer_name = v_card_name
      where id = p_order_id;
    end if;

    if p_order ? 'delivery_method' then
      if (p_order ->> 'delivery_method') not in ('local_dropoff', 'shipping') then
        raise exception 'delivery_method must be local_dropoff or shipping';
      end if;
      update public.orders
      set delivery_method = p_order ->> 'delivery_method'
      where id = p_order_id;
    end if;

    if p_order ? 'general_notes' then
      update public.orders
      set general_notes = nullif(trim(coalesce(p_order ->> 'general_notes', '')), '')
      where id = p_order_id;
    end if;


    if p_order ? 'queue_speed' then
      update public.orders
      set queue_speed = public.normalize_queue_speed(
        p_order ->> 'queue_speed',
        coalesce((p_order ->> 'is_priority')::boolean, false)
      )
      where id = p_order_id;
    elsif p_order ? 'is_priority' then
      update public.orders
      set is_priority = coalesce((p_order ->> 'is_priority')::boolean, false)
      where id = p_order_id;
    end if;

    if p_order ? 'photos_drive_url' then
      v_drive_url := nullif(trim(coalesce(p_order ->> 'photos_drive_url', '')), '');
      update public.orders
      set photos_drive_url = v_drive_url
      where id = p_order_id;
    end if;

    if p_order ? 'quote_bulk_counts' then
      if p_order -> 'quote_bulk_counts' is null
         or p_order ->> 'quote_bulk_counts' is null
         or p_order ->> 'quote_bulk_counts' = 'null'
         or p_order ->> 'quote_bulk_counts' = '' then
        update public.orders
        set quote_bulk_counts = null
        where id = p_order_id;
      else
        if jsonb_typeof(p_order -> 'quote_bulk_counts') <> 'object' then
          raise exception 'quote_bulk_counts must be an object';
        end if;
        v_bulk_counts := p_order -> 'quote_bulk_counts';
        update public.orders
        set quote_bulk_counts = v_bulk_counts
        where id = p_order_id;
      end if;
    end if;

    if p_order ? 'quote_override_label' or p_order ? 'quote_override_amount' then
      v_override_label := nullif(
        trim(coalesce(p_order ->> 'quote_override_label', '')),
        ''
      );

      if p_order ->> 'quote_override_amount' is null
         or trim(coalesce(p_order ->> 'quote_override_amount', '')) = '' then
        v_override_amount := null;
      else
        begin
          v_override_amount := (p_order ->> 'quote_override_amount')::numeric(10, 2);
        exception
          when others then
            raise exception 'quote_override_amount must be a number';
        end;
      end if;

      if (v_override_label is null) <> (v_override_amount is null) then
        raise exception 'quote override requires both label and amount, or neither';
      end if;

      update public.orders
      set
        quote_override_label = v_override_label,
        quote_override_amount = v_override_amount
      where id = p_order_id;
    end if;

    if p_order ? 'status' then
      v_status := p_order ->> 'status';
      if v_status = 'delivered' then
        v_status := 'completed';
      end if;
      if v_status = 'cancelled' then
        v_status := 'canceled';
      end if;
      if v_status in ('on_hold', 'pending_quote', 'pending_dropoff') then
        v_status := 'pending';
      end if;
      if v_status = 'ready_for_customer' then
        v_status := 'ready';
      end if;
      if v_status not in ('new', 'pending', 'in_progress', 'ready', 'completed', 'canceled') then
        raise exception 'invalid status';
      end if;

      if v_status is distinct from v_prev_status then
        v_order_status_manually_set := true;
      end if;

      update public.orders
      set
        status = v_status,
        pending_kind = case
          when v_status = 'pending' then coalesce(
            nullif(trim(coalesce(p_order ->> 'pending_kind', '')), ''),
            pending_kind,
            'quote'
          )
          else null
        end,
        completed_at = case
          when v_status in ('completed', 'canceled')
               and v_prev_status is distinct from v_status
               and v_prev_status not in ('completed', 'canceled')
            then now()
          when v_status in ('completed', 'canceled')
               and v_prev_status in ('completed', 'canceled')
            then completed_at
          when v_status in ('completed', 'canceled')
            then coalesce(completed_at, now())
          else null
        end
      where id = p_order_id;
    elsif p_order ? 'pending_kind' then
      if v_prev_status is distinct from 'pending'
         and v_prev_status is distinct from 'on_hold' then
        raise exception 'pending_kind only applies to pending orders';
      end if;
      v_pending_kind := trim(coalesce(p_order ->> 'pending_kind', ''));
      if v_pending_kind not in ('quote', 'drop_off') then
        raise exception 'pending_kind must be quote or drop_off';
      end if;
      update public.orders
      set pending_kind = v_pending_kind
      where id = p_order_id;
    end if;

    if p_order ? 'quote_items' then
      v_quote_items := p_order -> 'quote_items';
      if v_quote_items is null or jsonb_typeof(v_quote_items) <> 'array' then
        raise exception 'quote_items must be an array';
      end if;

      delete from public.order_quote_items qi where qi.order_id = p_order_id;

      v_sort_order := 0;
      for v_quote_item in select * from jsonb_array_elements(v_quote_items)
      loop
        v_card_name := trim(coalesce(v_quote_item ->> 'card_name', ''));
        if v_card_name = '' then
          raise exception 'quote item card_name is required';
        end if;

        v_set_name := nullif(trim(coalesce(v_quote_item ->> 'set_name', '')), '');

        v_quote_card_id := null;
        if v_quote_item ? 'card_id' and nullif(trim(coalesce(v_quote_item ->> 'card_id', '')), '') is not null then
          begin
            v_quote_card_id := (v_quote_item ->> 'card_id')::uuid;
          exception
            when others then
              raise exception 'quote item card_id must be a valid uuid';
          end;
          if not exists (
            select 1 from public.cards c
            where c.id = v_quote_card_id and c.order_id = p_order_id
          ) then
            -- Card may be created later in this transaction (deferred FK).
            -- Still reject ids that already belong to a different order.
            if exists (select 1 from public.cards c where c.id = v_quote_card_id) then
              raise exception 'quote item card_id not on order';
            end if;
          end if;
        end if;

        v_service_key := trim(coalesce(v_quote_item ->> 'service_key', ''));
        if v_service_key = '' then
          raise exception 'quote item service_key is required';
        end if;

        v_service_label := trim(coalesce(v_quote_item ->> 'service_label', ''));
        if v_service_label = '' then
          raise exception 'quote item service_label is required';
        end if;

        begin
          v_base_amount := (v_quote_item ->> 'quote_base_amount')::numeric(10, 2);
        exception
          when others then
            raise exception 'quote item quote_base_amount must be a number';
        end;

        if v_quote_item ->> 'high_value_surcharge' is null
           or trim(coalesce(v_quote_item ->> 'high_value_surcharge', '')) = '' then
          v_hv_surcharge := null;
        else
          begin
            v_hv_surcharge := (v_quote_item ->> 'high_value_surcharge')::numeric(10, 2);
          exception
            when others then
              raise exception 'quote item high_value_surcharge must be a number';
          end;
        end if;

        v_quote_id := null;
        if v_quote_item ? 'id' and v_quote_item ->> 'id' is not null then
          begin
            v_quote_id := (v_quote_item ->> 'id')::uuid;
          exception
            when others then
              v_quote_id := null;
          end;
        end if;
        if v_quote_id is null then
          v_quote_id := gen_random_uuid();
        end if;

        insert into public.order_quote_items (
          id,
          order_id,
          sort_order,
          card_id,
          card_name,
          set_name,
          service_key,
          service_label,
          quote_base_amount,
          high_value_surcharge
        )
        values (
          v_quote_id,
          p_order_id,
          v_sort_order,
          v_quote_card_id,
          v_card_name,
          v_set_name,
          v_service_key,
          v_service_label,
          v_base_amount,
          v_hv_surcharge
        );

        v_sort_order := v_sort_order + 1;
      end loop;
    end if;
  end if;

  if p_contacts is not null then
    if jsonb_typeof(p_contacts) <> 'array' then
      raise exception 'contacts must be an array';
    end if;

    for v_contact in select * from jsonb_array_elements(p_contacts)
    loop
      v_contact_type := v_contact ->> 'contact_type';
      v_value := trim(coalesce(v_contact ->> 'value', ''));

      if v_contact ? 'id' and v_contact ->> 'id' is not null then
        v_contact_id := (v_contact ->> 'id')::bigint;

        if not exists (
          select 1 from public.contacts
          where id = v_contact_id and order_id = p_order_id
        ) then
          raise exception 'contact % not found on order', v_contact_id;
        end if;

        if v_contact ? 'contact_type'
           and v_contact_type not in ('phone', 'discord', 'instagram') then
          raise exception 'invalid contact_type';
        end if;
        if v_contact ? 'value' and v_value = '' then
          raise exception 'contact value cannot be empty';
        end if;

        update public.contacts
        set
          contact_type = coalesce(v_contact_type, contact_type),
          value = case when v_contact ? 'value' then v_value else value end
        where id = v_contact_id;
      else
        if v_contact_type is null
           or v_contact_type not in ('phone', 'discord', 'instagram') then
          raise exception 'invalid contact_type';
        end if;
        if v_value = '' then
          raise exception 'contact value is required';
        end if;

        insert into public.contacts (order_id, contact_type, value)
        values (p_order_id, v_contact_type, v_value);
      end if;
    end loop;
  end if;

  if p_cards is not null then
    if jsonb_typeof(p_cards) <> 'array' then
      raise exception 'cards must be an array';
    end if;

    v_card_sort := 0;
    for v_card in select * from jsonb_array_elements(p_cards)
    loop
      v_images := coalesce(v_card -> 'images', '[]'::jsonb);

      v_card_id := null;
      if v_card ? 'id' and v_card ->> 'id' is not null then
        begin
          v_card_id := (v_card ->> 'id')::uuid;
        exception
          when others then
            raise exception 'card id must be a valid uuid';
        end;
      end if;

      if v_card_id is not null and exists (
        select 1 from public.cards
        where id = v_card_id and order_id = p_order_id
      ) then
        if v_card ? 'card_name' then
          v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
          if v_card_name = '' then
            raise exception 'card_name cannot be empty';
          end if;
          update public.cards set card_name = v_card_name where id = v_card_id;
        end if;

        if v_card ? 'set_name' then
          update public.cards
          set set_name = nullif(trim(coalesce(v_card ->> 'set_name', '')), '')
          where id = v_card_id;
        end if;

        if v_card ? 'description' then
          update public.cards
          set description = nullif(trim(coalesce(v_card ->> 'description', '')), '')
          where id = v_card_id;
        end if;

        if v_card ? 'damage_tags' then
          v_damage_tags := '{}';
          v_seen_damage := '{}';
          if v_card -> 'damage_tags' is null then
            v_damage_tags := '{}';
          else
            v_damage_raw := v_card -> 'damage_tags';
            if jsonb_typeof(v_damage_raw) <> 'array' then
              raise exception 'card damage_tags must be an array';
            end if;
            for v_damage_tag in
              select trim(value)
              from jsonb_array_elements_text(v_damage_raw)
            loop
              if v_damage_tag = '' then
                continue;
              end if;
              if v_damage_tag = any (v_seen_damage) then
                continue;
              end if;
              if v_damage_tag not in (
                'crease',
                'scratching',
                'dent',
                'edge_lift',
                'edge_peeling',
                'dirt',
                'water_damage',
                'warping',
                'whitening'
              ) then
                raise exception 'invalid damage_tag: %', v_damage_tag;
              end if;
              v_seen_damage := array_append(v_seen_damage, v_damage_tag);
              v_damage_tags := array_append(v_damage_tags, v_damage_tag);
            end loop;
          end if;
          update public.cards
          set damage_tags = v_damage_tags
          where id = v_card_id;
        end if;

        if v_card ? 'admin_note' then
          update public.cards
          set admin_note = nullif(trim(coalesce(v_card ->> 'admin_note', '')), '')
          where id = v_card_id;
        end if;

        if v_card ? 'market_value_raw_nm' then
          if v_card ->> 'market_value_raw_nm' is null
             or trim(coalesce(v_card ->> 'market_value_raw_nm', '')) = '' then
            v_market_value := null;
          else
            begin
              v_market_value := (v_card ->> 'market_value_raw_nm')::numeric(10, 2);
            exception
              when others then
                raise exception 'card market_value_raw_nm must be a number';
            end;
            if v_market_value < 0 then
              raise exception 'card market_value_raw_nm cannot be negative';
            end if;
          end if;
          update public.cards
          set market_value_raw_nm = v_market_value
          where id = v_card_id;
        end if;

        if v_card ? 'status' then
          v_card_status := trim(coalesce(v_card ->> 'status', ''));
          if v_card_status = 'new' then
            v_card_status := 'todo';
          end if;
          if v_card_status = 'cancelled' then
            v_card_status := 'canceled';
          end if;
          if v_card_status not in ('todo', 'in_progress', 'completed', 'canceled') then
            raise exception 'invalid card status';
          end if;
          select status into v_prev_card_status
          from public.cards
          where id = v_card_id;
          if v_prev_card_status is distinct from v_card_status then
            v_card_status_changed := true;
          end if;
          update public.cards
          set status = v_card_status
          where id = v_card_id;
        end if;

      else
        if v_card_id is null then
          v_card_id := gen_random_uuid();
        end if;

        v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
        if v_card_name = '' then
          raise exception 'card_name is required';
        end if;

        v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');
        v_description := nullif(trim(coalesce(v_card ->> 'description', '')), '');
        v_admin_note := nullif(trim(coalesce(v_card ->> 'admin_note', '')), '');

        v_damage_tags := '{}';
        v_seen_damage := '{}';
        if v_card ? 'damage_tags' and v_card -> 'damage_tags' is not null then
          v_damage_raw := v_card -> 'damage_tags';
          if jsonb_typeof(v_damage_raw) <> 'array' then
            raise exception 'card damage_tags must be an array';
          end if;
          for v_damage_tag in
            select trim(value)
            from jsonb_array_elements_text(v_damage_raw)
          loop
            if v_damage_tag = '' then
              continue;
            end if;
            if v_damage_tag = any (v_seen_damage) then
              continue;
            end if;
            if v_damage_tag not in (
              'crease',
              'scratching',
              'dent',
              'edge_lift',
              'edge_peeling',
              'dirt',
              'water_damage',
              'warping',
              'whitening'
            ) then
              raise exception 'invalid damage_tag: %', v_damage_tag;
            end if;
            v_seen_damage := array_append(v_seen_damage, v_damage_tag);
            v_damage_tags := array_append(v_damage_tags, v_damage_tag);
          end loop;
        end if;

        if v_card ->> 'market_value_raw_nm' is null
           or trim(coalesce(v_card ->> 'market_value_raw_nm', '')) = '' then
          v_market_value := null;
        else
          begin
            v_market_value := (v_card ->> 'market_value_raw_nm')::numeric(10, 2);
          exception
            when others then
              raise exception 'card market_value_raw_nm must be a number';
          end;
          if v_market_value < 0 then
            raise exception 'card market_value_raw_nm cannot be negative';
          end if;
        end if;

        v_card_status := trim(coalesce(v_card ->> 'status', 'todo'));
        if v_card_status = '' then
          v_card_status := 'todo';
        end if;
        if v_card_status = 'new' then
          v_card_status := 'todo';
        end if;
        if v_card_status = 'cancelled' then
          v_card_status := 'canceled';
        end if;
        if v_card_status not in ('todo', 'in_progress', 'completed', 'canceled') then
          raise exception 'invalid card status';
        end if;

        insert into public.cards (
          id,
          order_id,
          card_name,
          set_name,
          description,
          damage_tags,
          admin_note,
          market_value_raw_nm,
          status,
          sort_order
        )
        values (
          v_card_id,
          p_order_id,
          v_card_name,
          v_set_name,
          v_description,
          v_damage_tags,
          v_admin_note,
          v_market_value,
          v_card_status,
          v_card_sort
        );
      end if;

      update public.cards
      set sort_order = v_card_sort
      where id = v_card_id;

      v_kept_card_ids := array_append(v_kept_card_ids, v_card_id);
      v_card_sort := v_card_sort + 1;

      if jsonb_typeof(v_images) = 'array' then
        for v_image in select * from jsonb_array_elements(v_images)
        loop
          if trim(coalesce(v_image ->> 'storage_path', '')) = '' then
            raise exception 'image storage_path is required';
          end if;
          v_image_type := coalesce(v_image ->> 'image_type', 'customer');
          if not (v_image_type = any(v_allowed_image_types)) then
            raise exception 'invalid image_type';
          end if;

          insert into public.card_images (card_id, image_type, storage_path)
          values (
            v_card_id,
            v_image_type,
            trim(v_image ->> 'storage_path')
          );
        end loop;
      end if;
    end loop;

    delete from public.cards c
    where c.order_id = p_order_id
      and not (c.id = any (v_kept_card_ids));
  end if;

  perform public.maybe_auto_pending_dropoff(p_order_id);


  -- Auto-advance from cards unless order status was edited this save:
  -- all completed → ready; else any in_progress → in_progress.
  if not v_order_status_manually_set then
    select status into v_status from public.orders where id = p_order_id;
    if v_status not in ('ready', 'completed', 'canceled') then
      if exists (
        select 1
        from public.cards c
        where c.order_id = p_order_id
      ) and not exists (
        select 1
        from public.cards c
        where c.order_id = p_order_id
          and c.status is distinct from 'completed'
      ) then
        update public.orders
        set
          status = 'ready',
          pending_kind = null,
          status_changed_at = now()
        where id = p_order_id;
      elsif exists (
        select 1
        from public.cards c
        where c.order_id = p_order_id
          and c.status = 'in_progress'
      ) and v_status is distinct from 'in_progress' then
        update public.orders
        set
          status = 'in_progress',
          pending_kind = null,
          status_changed_at = now()
        where id = p_order_id;
      end if;
    end if;
  end if;

  select * into v_order from public.orders where id = p_order_id;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes,
    'photos_drive_url', v_order.photos_drive_url,
    'status', v_order.status,
    'pending_kind', v_order.pending_kind,
    'completed_at', v_order.completed_at,
    'quote_bulk_counts', v_order.quote_bulk_counts,
    'quote_override_label', v_order.quote_override_label,
    'quote_override_amount', v_order.quote_override_amount,
    'is_priority', v_order.is_priority,
    'queue_speed', v_order.queue_speed
  );
end;
$function$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.queue_speed IS DISTINCT FROM 'standard'
       OR o.is_priority = true
       OR (
         o.quote_bulk_counts IS NOT NULL
         AND jsonb_typeof(o.quote_bulk_counts -> 'adjustments') = 'array'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(o.quote_bulk_counts -> 'adjustments') elem
           WHERE public.is_queue_speed_adjustment_label(elem ->> 'description')
         )
       )
  LOOP
    PERFORM public.sync_order_priority_quote_adjustment(r.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_queue_speed(text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.normalize_queue_speed(text, boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.queue_speed_rank(text) FROM public;
GRANT EXECUTE ON FUNCTION public.queue_speed_rank(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.queue_speed_fee(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.queue_speed_fee(text, integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._split_off_queue_speed(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public._split_off_queue_speed(uuid, text) TO service_role;

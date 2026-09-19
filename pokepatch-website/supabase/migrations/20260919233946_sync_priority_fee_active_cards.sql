-- Priority fee is $15 per active (non-canceled) card.
-- Keep quote_bulk_counts "Priority service" row in sync when cards change
-- or is_priority toggles (admin cancel + customer card delete / priority toggle).

CREATE OR REPLACE FUNCTION public.priority_service_fee(p_card_count integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (GREATEST(0, COALESCE(p_card_count, 0)) * 15)::numeric(10, 2);
$$;

REVOKE ALL ON FUNCTION public.priority_service_fee(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.priority_service_fee(integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_order_priority_quote_adjustment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_priority boolean;
  v_bulk jsonb;
  v_active_count integer;
  v_fee numeric(10, 2);
  v_adjustments jsonb;
  v_without jsonb;
  v_card_hv jsonb;
  v_next jsonb;
  v_priority_id text;
BEGIN
  SELECT o.is_priority, o.quote_bulk_counts
  INTO v_is_priority, v_bulk
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO v_active_count
  FROM public.cards c
  WHERE c.order_id = p_order_id
    AND c.status IS DISTINCT FROM 'canceled';

  v_fee := public.priority_service_fee(v_active_count);

  -- Only rewrite version-2 (or empty) quote payloads; leave legacy bulk maps alone.
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
  WHERE lower(trim(coalesce(elem ->> 'description', '')))
        IS DISTINCT FROM 'priority service';

  IF coalesce(v_is_priority, false) AND v_fee > 0 THEN
    -- Reuse existing Priority service row id when present so idempotent syncs
    -- do not churn quote_bulk_counts on every card touch.
    SELECT elem ->> 'id'
    INTO v_priority_id
    FROM jsonb_array_elements(v_adjustments) elem
    WHERE lower(trim(coalesce(elem ->> 'description', ''))) = 'priority service'
    LIMIT 1;

    v_without := v_without || jsonb_build_array(
      jsonb_build_object(
        'id', coalesce(nullif(trim(coalesce(v_priority_id, '')), ''), gen_random_uuid()::text),
        'kind', 'surcharge',
        'description', 'Priority service',
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

REVOKE ALL ON FUNCTION public.sync_order_priority_quote_adjustment(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.sync_order_priority_quote_adjustment(uuid) TO service_role;

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

  -- Skip no-op status updates that do not change canceled vs active.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.status = 'canceled') = (OLD.status = 'canceled') THEN
    RETURN NEW;
  END IF;

  PERFORM public.sync_order_priority_quote_adjustment(v_order_id);
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cards_sync_priority_quote ON public.cards;
CREATE TRIGGER trg_cards_sync_priority_quote
AFTER INSERT OR DELETE OR UPDATE OF status
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
  IF NEW.is_priority IS NOT DISTINCT FROM OLD.is_priority THEN
    RETURN NEW;
  END IF;
  PERFORM public.sync_order_priority_quote_adjustment(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_priority_quote ON public.orders;
CREATE TRIGGER trg_orders_sync_priority_quote
AFTER UPDATE OF is_priority
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_order_priority_quote_from_order();

-- Repair existing priority rows that still charge for canceled cards.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.orders o
    WHERE o.is_priority = true
       OR (
         o.quote_bulk_counts IS NOT NULL
         AND jsonb_typeof(o.quote_bulk_counts -> 'adjustments') = 'array'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(o.quote_bulk_counts -> 'adjustments') elem
           WHERE lower(trim(coalesce(elem ->> 'description', ''))) = 'priority service'
         )
       )
  LOOP
    PERFORM public.sync_order_priority_quote_adjustment(r.id);
  END LOOP;
END;
$$;

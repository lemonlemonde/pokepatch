-- Queue priority applies only to To do (status = new). Other columns keep
-- chronological order; reordering in progress / pending / etc. is not allowed.

CREATE OR REPLACE FUNCTION public.orders_set_queue_priority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'new' THEN
      IF NEW.queue_priority IS NULL THEN
        SELECT COALESCE(MAX(queue_priority), -1) + 1
          INTO NEW.queue_priority
        FROM public.orders
        WHERE status = 'new';
      END IF;
    ELSE
      NEW.queue_priority := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'new' THEN
      IF NEW.queue_priority IS NOT DISTINCT FROM OLD.queue_priority THEN
        SELECT COALESCE(MAX(queue_priority), -1) + 1
          INTO NEW.queue_priority
        FROM public.orders
        WHERE status = 'new'
          AND id IS DISTINCT FROM NEW.id;
      END IF;
    ELSE
      NEW.queue_priority := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_status_orders(
  p_status text,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_index integer := 0;
  v_status text;
BEGIN
  IF p_ordered_ids IS NULL THEN
    RAISE EXCEPTION 'ordered_ids is required';
  END IF;

  v_status := CASE
    WHEN p_status IN ('new', 'todo') THEN 'new'
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'queue reorder is only allowed for To do (new) orders';
  END IF;

  FOREACH v_id IN ARRAY p_ordered_ids
  LOOP
    UPDATE public.orders
    SET queue_priority = v_index
    WHERE id = v_id
      AND status = v_status;
    v_index := v_index + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_order_in_status(
  p_order_id uuid,
  p_status text,
  p_queue_index integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_old_status text;
  v_ids uuid[];
  v_filtered uuid[];
  v_insert_at integer;
BEGIN
  v_status := CASE
    WHEN p_status IN ('new', 'todo') THEN 'new'
    WHEN p_status IN ('on_hold', 'pending', 'pending_quote', 'pending_dropoff') THEN 'pending'
    WHEN p_status IN ('ready', 'ready_for_customer') THEN 'ready'
    WHEN p_status IN ('in_progress', 'completed', 'canceled', 'cancelled') THEN
      CASE WHEN p_status = 'cancelled' THEN 'canceled' ELSE p_status END
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  SELECT status INTO v_old_status
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF v_old_status IS DISTINCT FROM v_status THEN
    UPDATE public.orders
    SET
      status = v_status,
      pending_kind = CASE
        WHEN v_status = 'pending' THEN COALESCE(pending_kind, 'quote')
        ELSE NULL
      END,
      status_changed_at = now(),
      completed_at = CASE
        WHEN v_status IN ('completed', 'canceled') THEN COALESCE(completed_at, now())
        ELSE NULL
      END
    WHERE id = p_order_id;
  END IF;

  IF v_status = 'new' THEN
    SELECT COALESCE(array_agg(id ORDER BY queue_priority ASC NULLS LAST, created_at ASC NULLS LAST, id ASC), '{}')
      INTO v_ids
    FROM public.orders
    WHERE status = 'new';

    SELECT COALESCE(array_agg(id), '{}')
      INTO v_filtered
    FROM unnest(v_ids) AS id
    WHERE id IS DISTINCT FROM p_order_id;

    IF p_queue_index IS NULL OR p_queue_index >= coalesce(cardinality(v_filtered), 0) THEN
      v_ids := v_filtered || ARRAY[p_order_id];
    ELSIF p_queue_index <= 0 THEN
      v_ids := ARRAY[p_order_id] || v_filtered;
    ELSE
      v_insert_at := p_queue_index;
      v_ids :=
        v_filtered[1:v_insert_at]
        || ARRAY[p_order_id]
        || v_filtered[v_insert_at + 1 : cardinality(v_filtered)];
    END IF;

    PERFORM public.reorder_status_orders('new', v_ids);
  END IF;

  IF v_old_status = 'new' AND v_status IS DISTINCT FROM 'new' THEN
    SELECT COALESCE(array_agg(id ORDER BY queue_priority ASC NULLS LAST, created_at ASC NULLS LAST, id ASC), '{}')
      INTO v_ids
    FROM public.orders
    WHERE status = 'new';
    IF cardinality(v_ids) > 0 THEN
      PERFORM public.reorder_status_orders('new', v_ids);
    END IF;
  END IF;
END;
$$;

-- Clear stale per-status ranks on non-todo orders.
UPDATE public.orders
SET queue_priority = NULL
WHERE status IS DISTINCT FROM 'new'
  AND queue_priority IS NOT NULL;

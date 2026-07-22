-- Per-status relative queue_priority (rank within each status column).
-- Absolute numbers are rewritten as 0..n-1 per status on reorder.
--
-- Safety: additive function/trigger updates only; no DROP of data.

-- 1) Insert / status-change: append within the target status
CREATE OR REPLACE FUNCTION public.orders_set_queue_priority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.queue_priority IS NULL THEN
      SELECT COALESCE(MAX(queue_priority), -1) + 1
        INTO NEW.queue_priority
      FROM public.orders
      WHERE status = NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: when status changes, append in the new column unless caller set priority
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.queue_priority IS NOT DISTINCT FROM OLD.queue_priority THEN
      SELECT COALESCE(MAX(queue_priority), -1) + 1
        INTO NEW.queue_priority
      FROM public.orders
      WHERE status = NEW.status
        AND id IS DISTINCT FROM NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_set_queue_priority_bi ON public.orders;
DROP TRIGGER IF EXISTS orders_set_queue_priority_bu ON public.orders;

CREATE TRIGGER orders_set_queue_priority_bi
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_set_queue_priority();

CREATE TRIGGER orders_set_queue_priority_bu
  BEFORE UPDATE OF status, queue_priority ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_set_queue_priority();

-- 2) Backfill dense ranks per status (preserve relative order)
WITH ranked AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      PARTITION BY status
      ORDER BY queue_priority ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    ) - 1)::integer AS rank
  FROM public.orders
)
UPDATE public.orders o
SET queue_priority = ranked.rank
FROM ranked
WHERE o.id = ranked.id
  AND o.queue_priority IS DISTINCT FROM ranked.rank;

-- 3) Reorder one status column to match ordered ids (0..n-1)
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
    WHEN p_status IN ('in_progress', 'completed', 'canceled', 'cancelled') THEN
      CASE WHEN p_status = 'cancelled' THEN 'canceled' ELSE p_status END
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
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

REVOKE ALL ON FUNCTION public.reorder_status_orders(text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_status_orders(text, uuid[]) TO service_role;

-- 4) Move order into a status at an optional index (null = append), renumber columns
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

  -- Apply status (+ completed_at) when changing columns
  IF v_old_status IS DISTINCT FROM v_status THEN
    UPDATE public.orders
    SET
      status = v_status,
      status_changed_at = now(),
      completed_at = CASE
        WHEN v_status IN ('completed', 'canceled') THEN COALESCE(completed_at, now())
        ELSE NULL
      END
      -- leave queue_priority so BEFORE UPDATE trigger appends in new status
    WHERE id = p_order_id;
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY queue_priority ASC NULLS LAST, created_at ASC NULLS LAST, id ASC), '{}')
    INTO v_ids
  FROM public.orders
  WHERE status = v_status;

  -- Remove the moved order, then insert at index
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

  PERFORM public.reorder_status_orders(v_status, v_ids);

  -- Densify the source column after a cross-column move
  IF v_old_status IS DISTINCT FROM v_status THEN
    SELECT COALESCE(array_agg(id ORDER BY queue_priority ASC NULLS LAST, created_at ASC NULLS LAST, id ASC), '{}')
      INTO v_ids
    FROM public.orders
    WHERE status = v_old_status;
    PERFORM public.reorder_status_orders(v_old_status, v_ids);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.move_order_in_status(uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.move_order_in_status(uuid, text, integer) TO service_role;

-- Keep legacy reorder_queue_orders as thin wrapper (To do only)
CREATE OR REPLACE FUNCTION public.reorder_queue_orders(p_ordered_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.reorder_status_orders('new', p_ordered_ids);
  RETURN public.list_queue_orders();
END;
$$;

CREATE INDEX IF NOT EXISTS orders_status_queue_priority_idx
  ON public.orders (status, queue_priority ASC NULLS LAST);

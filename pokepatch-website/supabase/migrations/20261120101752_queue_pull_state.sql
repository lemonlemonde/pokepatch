-- Shared To do → In progress fairness pointer.
-- Immediate always goes next and does not consume the cadence.
-- Among the rest: Rush × 3, Priority × 2, Standard × 1 (skip empty lanes).
-- Persist cycle_index + the current next To-do order so every admin session
-- sees the same "Next" banner.

CREATE TABLE public.queue_pull_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cycle_index integer NOT NULL DEFAULT 0,
  next_order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.queue_pull_state IS
  'Singleton fairness pointer for To do pulls. cycle_index walks Rush×3, Priority×2, Standard×1.';
COMMENT ON COLUMN public.queue_pull_state.cycle_index IS
  'Index into queue_pull_cycle(). Immediate pulls leave this unchanged.';
COMMENT ON COLUMN public.queue_pull_state.next_order_id IS
  'Current next To-do order (Immediate, else the cadence lane). Recomputed on todo/cycle changes.';

INSERT INTO public.queue_pull_state (id, cycle_index)
VALUES (true, 0);

ALTER TABLE public.queue_pull_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.queue_pull_state FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_pull_cycle()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT ARRAY['express', 'express', 'express', 'fast', 'fast', 'standard']::text[];
$$;

COMMENT ON FUNCTION public.queue_pull_cycle() IS
  'Waiting-lane pull cadence: Rush, Rush, Rush, Priority, Priority, Standard.';

CREATE OR REPLACE FUNCTION public.normalize_queue_pull_cycle_index(p_index integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_index IS NULL OR p_index < 0 THEN 0
    ELSE p_index % GREATEST(cardinality(public.queue_pull_cycle()), 1)
  END;
$$;

-- First order in each waiting lane, plus Immediate, matching admin To-do sort:
-- fastest first, then FIFO by todo_entered_at within the lane.
CREATE OR REPLACE FUNCTION public.pick_next_todo_order_id(p_cycle_index integer)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_cycle text[] := public.queue_pull_cycle();
  v_len integer := GREATEST(cardinality(v_cycle), 1);
  v_start integer := public.normalize_queue_pull_cycle_index(p_cycle_index);
  v_step integer;
  v_speed text;
  v_id uuid;
BEGIN
  SELECT o.id
  INTO v_id
  FROM public.orders o
  WHERE o.status = 'new'
    AND public.normalize_queue_speed(o.queue_speed, o.is_priority) = 'immediate'
  ORDER BY
    COALESCE(o.todo_entered_at, o.status_changed_at, o.created_at) ASC NULLS LAST,
    o.created_at ASC NULLS LAST,
    o.id ASC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  FOR v_step IN 0 .. (v_len - 1) LOOP
    v_speed := v_cycle[1 + ((v_start + v_step) % v_len)];
    SELECT o.id
    INTO v_id
    FROM public.orders o
    WHERE o.status = 'new'
      AND public.normalize_queue_speed(o.queue_speed, o.is_priority) = v_speed
    ORDER BY
      COALESCE(o.todo_entered_at, o.status_changed_at, o.created_at) ASC NULLS LAST,
      o.created_at ASC NULLS LAST,
      o.id ASC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_queue_pull_next()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cycle integer;
  v_next uuid;
BEGIN
  SELECT cycle_index
  INTO v_cycle
  FROM public.queue_pull_state
  WHERE id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.queue_pull_state (id, cycle_index)
    VALUES (true, 0)
    ON CONFLICT (id) DO NOTHING;
    v_cycle := 0;
  END IF;

  v_next := public.pick_next_todo_order_id(v_cycle);

  UPDATE public.queue_pull_state
  SET
    next_order_id = v_next,
    updated_at = now()
  WHERE id;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_queue_pull(p_speed text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cycle text[] := public.queue_pull_cycle();
  v_len integer := GREATEST(cardinality(v_cycle), 1);
  v_speed text := public.normalize_queue_speed(p_speed, false);
  v_start integer;
  v_step integer;
  v_index integer;
  v_next integer;
BEGIN
  IF v_speed = 'immediate' THEN
    PERFORM public.refresh_queue_pull_next();
    RETURN;
  END IF;

  SELECT cycle_index
  INTO v_start
  FROM public.queue_pull_state
  WHERE id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.queue_pull_state (id, cycle_index)
    VALUES (true, 0)
    ON CONFLICT (id) DO NOTHING;
    SELECT cycle_index INTO v_start FROM public.queue_pull_state WHERE id FOR UPDATE;
  END IF;

  v_start := public.normalize_queue_pull_cycle_index(v_start);
  v_next := (v_start + 1) % v_len;
  FOR v_step IN 0 .. (v_len - 1) LOOP
    v_index := (v_start + v_step) % v_len;
    IF v_cycle[1 + v_index] = v_speed THEN
      v_next := (v_index + 1) % v_len;
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.queue_pull_state
  SET
    cycle_index = v_next,
    updated_at = now()
  WHERE id;

  PERFORM public.refresh_queue_pull_next();
END;
$$;

CREATE OR REPLACE FUNCTION public.orders_advance_queue_pull()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'new'
     AND NEW.status = 'in_progress' THEN
    PERFORM public.advance_queue_pull(NEW.queue_speed);
    RETURN NEW;
  END IF;

  PERFORM public.refresh_queue_pull_next();
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_queue_pull_state ON public.orders;
CREATE TRIGGER orders_queue_pull_state
  AFTER INSERT OR DELETE OR UPDATE OF status, queue_speed, is_priority, todo_entered_at
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_advance_queue_pull();

-- Seed next_order_id from current To-do board.
SELECT public.refresh_queue_pull_next();

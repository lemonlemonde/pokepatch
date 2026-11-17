-- Customer-facing $30 waiting lane is Rush (still queue_speed = express).
-- Immediate stays the skip-the-line product. Match older "Express queue" rows.

CREATE OR REPLACE FUNCTION public.queue_speed_adjustment_label(p_speed text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE public.normalize_queue_speed(p_speed, false)
    WHEN 'immediate' THEN 'Immediate start'
    WHEN 'express' THEN 'Rush queue'
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
    'rush queue',
    'express queue',
    'priority queue',
    'fast queue',
    'priority service'
  );
$$;

-- Home Live Queue "In Queue": only todo cards on To do (new) orders.
-- Pending quote/drop-off cards are not in the workshop queue yet.

CREATE OR REPLACE FUNCTION public.get_queue_card_count()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'todo',
    (
      SELECT count(*)::integer
      FROM public.cards c
      INNER JOIN public.orders o ON o.id = c.order_id
      WHERE c.status = 'todo'
        AND o.status = 'new'
    ),
    'in_progress',
    (
      SELECT count(*)::integer
      FROM public.cards c
      WHERE c.status = 'in_progress'
    ),
    'completed',
    (
      SELECT count(*)::integer
      FROM public.cards c
      WHERE c.status = 'completed'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_queue_card_count() FROM public;
GRANT EXECUTE ON FUNCTION public.get_queue_card_count() TO anon, authenticated, service_role;

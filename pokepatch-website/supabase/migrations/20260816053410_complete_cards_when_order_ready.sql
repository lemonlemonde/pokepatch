-- When an order moves to ready (Ready for customer), mark all active cards
-- completed. Canceled cards stay canceled. Timers clear via the existing
-- cards_clear_timer_when_not_in_progress trigger.
--
-- DEFERRABLE so this runs at transaction end — after update_order finishes
-- applying any card payload on the same save (avoids cards being set back
-- to todo/in_progress by a stale draft).

CREATE OR REPLACE FUNCTION public.cards_complete_when_order_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready' THEN
    UPDATE public.cards
    SET status = 'completed'
    WHERE order_id = NEW.id
      AND status IS DISTINCT FROM 'completed'
      AND status IS DISTINCT FROM 'canceled';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS orders_complete_cards_when_ready ON public.orders;
CREATE CONSTRAINT TRIGGER orders_complete_cards_when_ready
  AFTER UPDATE OF status ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready')
  EXECUTE FUNCTION public.cards_complete_when_order_ready();

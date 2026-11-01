-- Uploading an "after" restoration photo means the card work is done.
-- Mark that card completed (unless canceled). When every active card on the
-- order is completed, advance the order to ready — same rule as update_order.

CREATE OR REPLACE FUNCTION public.cards_complete_when_after_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_order_status text;
BEGIN
  IF NEW.image_type IS DISTINCT FROM 'after' THEN
    RETURN NEW;
  END IF;

  UPDATE public.cards
  SET status = 'completed'
  WHERE id = NEW.card_id
    AND status IS DISTINCT FROM 'completed'
    AND status IS DISTINCT FROM 'canceled'
  RETURNING order_id INTO v_order_id;

  -- Only advance the order when this insert actually flipped the card status.
  IF v_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_order_status
  FROM public.orders
  WHERE id = v_order_id;

  IF v_order_status IS NULL
     OR v_order_status IN ('ready', 'completed', 'canceled') THEN
    RETURN NEW;
  END IF;

  -- Active (non-canceled) cards all completed → ready.
  IF EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.order_id = v_order_id
      AND c.status IS DISTINCT FROM 'canceled'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.order_id = v_order_id
      AND c.status IS DISTINCT FROM 'completed'
      AND c.status IS DISTINCT FROM 'canceled'
  ) THEN
    UPDATE public.orders
    SET
      status = 'ready',
      pending_kind = null,
      status_changed_at = now()
    WHERE id = v_order_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS card_images_complete_card_when_after ON public.card_images;
CREATE TRIGGER card_images_complete_card_when_after
  AFTER INSERT ON public.card_images
  FOR EACH ROW
  WHEN (NEW.image_type = 'after')
  EXECUTE FUNCTION public.cards_complete_when_after_photo();

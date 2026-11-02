-- Replacing before photos on a card that already has after photos must not
-- flip the card back to in_progress (or advance the order). That path is for
-- the first "work started" signal only — once afters exist, image swaps are
-- edits, not status transitions. Wooper notify follows the status delta, so
-- skipping the flip also skips the customer email.

CREATE OR REPLACE FUNCTION public.cards_in_progress_when_before_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_order_status text;
BEGIN
  IF NEW.image_type IS DISTINCT FROM 'before'
     AND NEW.image_type IS DISTINCT FROM 'progress_front'
     AND NEW.image_type IS DISTINCT FROM 'progress_back' THEN
    RETURN NEW;
  END IF;

  -- After (or legacy final_*) already present → treat as photo edit only.
  IF EXISTS (
    SELECT 1
    FROM public.card_images ci
    WHERE ci.card_id = NEW.card_id
      AND ci.image_type IN ('after', 'final_front', 'final_back')
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE public.cards
  SET status = 'in_progress'
  WHERE id = NEW.card_id
    AND status IS DISTINCT FROM 'in_progress'
    AND status IS DISTINCT FROM 'canceled'
  RETURNING order_id INTO v_order_id;

  -- Only touch the order when this insert actually flipped the card status.
  IF v_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_order_status
  FROM public.orders
  WHERE id = v_order_id;

  -- Leave terminal / already-working orders alone.
  IF v_order_status IS NULL
     OR v_order_status IN ('in_progress', 'completed', 'canceled') THEN
    RETURN NEW;
  END IF;

  UPDATE public.orders
  SET
    status = 'in_progress',
    pending_kind = null,
    status_changed_at = now()
  WHERE id = v_order_id;

  RETURN NEW;
END;
$$;

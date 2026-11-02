-- Uploading a "before" restoration photo means work has started on that card.
-- Mark the card in_progress (unless canceled) and advance the order to
-- in_progress when it is still in an earlier pipeline status — same spirit as
-- cards_complete_when_after_photo / update_order auto-advance.

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

DROP TRIGGER IF EXISTS card_images_in_progress_card_when_before ON public.card_images;
CREATE TRIGGER card_images_in_progress_card_when_before
  AFTER INSERT ON public.card_images
  FOR EACH ROW
  WHEN (
    NEW.image_type = 'before'
    OR NEW.image_type = 'progress_front'
    OR NEW.image_type = 'progress_back'
  )
  EXECUTE FUNCTION public.cards_in_progress_when_before_photo();

-- Keep after → completed in sync for legacy final_* image types too.
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
  IF NEW.image_type IS DISTINCT FROM 'after'
     AND NEW.image_type IS DISTINCT FROM 'final_front'
     AND NEW.image_type IS DISTINCT FROM 'final_back' THEN
    RETURN NEW;
  END IF;

  UPDATE public.cards
  SET status = 'completed'
  WHERE id = NEW.card_id
    AND status IS DISTINCT FROM 'completed'
    AND status IS DISTINCT FROM 'canceled'
  RETURNING order_id INTO v_order_id;

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
  WHEN (
    NEW.image_type = 'after'
    OR NEW.image_type = 'final_front'
    OR NEW.image_type = 'final_back'
  )
  EXECUTE FUNCTION public.cards_complete_when_after_photo();

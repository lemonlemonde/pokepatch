-- Guest (anon) quote submissions always failed with "at least one card is
-- required" even with a complete card, because the deferred constraint
-- triggers added in 20260919234807 aren't SECURITY DEFINER: they run as the
-- calling role. create_order() itself is SECURITY DEFINER so its card INSERTs
-- bypass RLS fine, but cards' only SELECT policy is scoped to "authenticated"
-- (see baseline). At commit, the trigger's own SELECT ... FROM public.cards
-- runs as "anon" for logged-out submits and sees zero rows regardless of what
-- was actually inserted, so it always raised the "no cards" exception for
-- guests. Authenticated submits happened to pass because their role matches
-- the cards SELECT policy.
--
-- Fix: run the existence check as the function owner so it reflects reality,
-- not the caller's row-visibility.

CREATE OR REPLACE FUNCTION public.enforce_order_has_card_after_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cards WHERE order_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_order_has_card_after_card_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Order itself is being removed (ON DELETE CASCADE) — allow emptying cards.
  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = OLD.order_id
  ) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cards WHERE order_id = OLD.order_id
  ) THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;
  RETURN NULL;
END;
$$;

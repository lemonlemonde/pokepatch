-- Every order must have at least one card at COMMIT.
--
-- create_order / update_my_order already insert cards in the same transaction
-- as the order row. Admin shell create goes through create_admin_order_shell so
-- the order + starter card commit together.
--
-- Cascade-deleting an order (cards go with it) is allowed.

CREATE OR REPLACE FUNCTION public.enforce_order_has_card_after_order_insert()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS orders_require_card_at_commit ON public.orders;
CREATE CONSTRAINT TRIGGER orders_require_card_at_commit
  AFTER INSERT ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_has_card_after_order_insert();

CREATE OR REPLACE FUNCTION public.enforce_order_has_card_after_card_delete()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS cards_keep_order_nonempty_at_commit ON public.cards;
CREATE CONSTRAINT TRIGGER cards_keep_order_nonempty_at_commit
  AFTER DELETE ON public.cards
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_has_card_after_card_delete();

-- Admin "new order" shell: order + one starter card in a single transaction so
-- the deferred card-required check passes.
CREATE OR REPLACE FUNCTION public.create_admin_order_shell(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid := gen_random_uuid();
  v_card_id uuid := gen_random_uuid();
  v_first_name text := trim(coalesce(p_payload ->> 'first_name', ''));
  v_last_name text := trim(coalesce(p_payload ->> 'last_name', ''));
  v_customer_email text := trim(coalesce(p_payload ->> 'customer_email', ''));
  v_delivery_method text := trim(coalesce(p_payload ->> 'delivery_method', ''));
  v_user_id uuid := null;
  v_customer_name text;
  v_order public.orders%rowtype;
BEGIN
  IF v_first_name = '' THEN
    RAISE EXCEPTION 'first_name required';
  END IF;
  IF v_last_name = '' THEN
    RAISE EXCEPTION 'last_name required';
  END IF;
  IF v_customer_email = '' THEN
    RAISE EXCEPTION 'customer_email required';
  END IF;
  IF v_delivery_method NOT IN ('local_dropoff', 'shipping') THEN
    RAISE EXCEPTION 'delivery_method must be local_dropoff or shipping';
  END IF;

  IF p_payload ? 'user_id' AND nullif(trim(coalesce(p_payload ->> 'user_id', '')), '') IS NOT NULL THEN
    BEGIN
      v_user_id := (p_payload ->> 'user_id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'user_id must be a valid uuid';
    END;
  END IF;

  v_customer_name := trim(v_first_name || ' ' || v_last_name);

  INSERT INTO public.orders (
    id, user_id, first_name, last_name, customer_name, customer_email,
    delivery_method, preferred_contact_type, preferred_contact_value,
    status, pending_kind, is_priority
  )
  VALUES (
    v_order_id, v_user_id, v_first_name, v_last_name, v_customer_name, v_customer_email,
    v_delivery_method, 'email', v_customer_email,
    'pending', 'quote', false
  )
  RETURNING * INTO v_order;

  INSERT INTO public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name,
    delivery_method, general_notes
  )
  VALUES (
    v_order.id, v_order.display_id, v_order.created_at, v_order.first_name,
    v_order.last_name, v_order.customer_name, v_order.delivery_method,
    v_order.general_notes
  );

  INSERT INTO public.cards (id, order_id, card_name, damage_tags)
  VALUES (v_card_id, v_order_id, 'New card', '{}');

  INSERT INTO public.cards_original (id, order_id, card_name, damage_tags)
  VALUES (v_card_id, v_order_id, 'New card', '{}');

  RETURN jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'first_name', v_order.first_name,
    'last_name', v_order.last_name,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_order_shell(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_admin_order_shell(jsonb) TO service_role;

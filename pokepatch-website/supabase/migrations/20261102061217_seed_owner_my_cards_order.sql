-- Permanent "My Cards" order for owner restorations (wooper / clamperl #-1).
-- Not a customer order: completed, no user_id, hidden from work queues in admin.

DO $$
DECLARE
  v_order_id uuid := gen_random_uuid();
  v_card_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.orders WHERE display_id = -1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.orders (
    id,
    display_id,
    created_at,
    first_name,
    last_name,
    customer_name,
    customer_email,
    delivery_method,
    preferred_contact_type,
    preferred_contact_value,
    status,
    pending_kind,
    is_priority,
    completed_at,
    status_changed_at,
    general_notes
  )
  OVERRIDING SYSTEM VALUE
  VALUES (
    v_order_id,
    -1,
    v_now,
    'Pokepatch',
    'Own cards',
    'Pokepatch (own cards)',
    NULL,
    'local_dropoff',
    NULL,
    NULL,
    'completed',
    NULL,
    false,
    v_now,
    v_now,
    'Owner portfolio — wooper/clamperl order #-1. Not a customer order.'
  );

  INSERT INTO public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name,
    delivery_method, general_notes
  )
  VALUES (
    v_order_id,
    -1,
    v_now,
    'Pokepatch',
    'Own cards',
    'Pokepatch (own cards)',
    'local_dropoff',
    'Owner portfolio — wooper/clamperl order #-1. Not a customer order.'
  );

  INSERT INTO public.cards (
    id, order_id, card_name, damage_tags, sort_order, status
  )
  VALUES (
    v_card_id, v_order_id, 'My card 1', '{}', 0, 'todo'
  );

  INSERT INTO public.cards_original (
    id, order_id, card_name, damage_tags
  )
  VALUES (
    v_card_id, v_order_id, 'My card 1', '{}'
  );
END;
$$;

-- Card Whitening list price: $25 → $35 for new orders.
-- Sync with src/lib/servicePricing.js QUOTE_SERVICES (card_whitening listPrice).
-- Existing order_quote_items rows are left unchanged — only orders created
-- (or whitening lines added) after this migration use the new price.
--
-- _create_order_partition: same body as 20260924075442, only the
-- card_whitening base amount differs.

CREATE OR REPLACE FUNCTION public._create_order_partition(
  p_order_id uuid,
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_customer_name text,
  p_customer_email text,
  p_delivery_method text,
  p_heard_about_source text,
  p_preferred_type text,
  p_preferred_value text,
  p_is_priority boolean,
  p_contacts jsonb,
  p_cards jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_contact jsonb;
  v_contact_row public.contacts%rowtype;
  v_card jsonb;
  v_card_id uuid;
  v_card_name text;
  v_set_name text;
  v_card_is_priority boolean;
  v_card_row public.cards%rowtype;
  v_image jsonb;
  v_image_row public.card_images%rowtype;
  v_images jsonb;
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_service_keys jsonb;
  v_service_key text;
  v_service_label text;
  v_base_amount numeric(10, 2);
  v_seen_keys text[] := '{}';
  v_sort_order int := 0;
  v_card_count int;
  v_priority_fee numeric(10, 2);
  v_quote_bulk jsonb := null;
BEGIN
  v_card_count := jsonb_array_length(p_cards);
  IF v_card_count < 1 THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;

  IF p_is_priority THEN
    v_priority_fee := public.priority_service_fee(v_card_count);
    v_quote_bulk := jsonb_build_object(
      'version', 2,
      'adjustments', jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'kind', 'surcharge',
          'description', 'Priority service',
          'amount_dollars', v_priority_fee,
          'amount_percent', null
        )
      )
    );
  END IF;

  INSERT INTO public.orders (
    id, user_id, first_name, last_name, customer_name, customer_email, delivery_method, general_notes,
    heard_about_source, preferred_contact_type, preferred_contact_value, status, pending_kind, is_priority,
    quote_bulk_counts
  )
  VALUES (
    p_order_id, p_user_id, p_first_name, p_last_name, p_customer_name, p_customer_email, p_delivery_method, null,
    p_heard_about_source, p_preferred_type, p_preferred_value, 'pending', 'quote', p_is_priority,
    v_quote_bulk
  )
  RETURNING * INTO v_order;

  INSERT INTO public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes
  )
  VALUES (
    v_order.id,
    v_order.display_id,
    v_order.created_at,
    v_order.first_name,
    v_order.last_name,
    v_order.customer_name,
    v_order.delivery_method,
    v_order.general_notes
  );

  FOR v_contact IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    INSERT INTO public.contacts (order_id, contact_type, value)
    VALUES (
      p_order_id,
      v_contact ->> 'contact_type',
      trim(v_contact ->> 'value')
    )
    RETURNING * INTO v_contact_row;

    INSERT INTO public.contacts_original (id, order_id, contact_type, value)
    VALUES (
      v_contact_row.id,
      p_order_id,
      v_contact_row.contact_type,
      v_contact_row.value
    );
  END LOOP;

  v_sort_order := 0;

  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    v_card_id := (v_card ->> 'id')::uuid;
    v_card_name := trim(v_card ->> 'card_name');
    v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');
    v_card_is_priority := coalesce((v_card ->> 'is_priority')::boolean, false);

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    IF v_card ? 'damage_tags' AND v_card -> 'damage_tags' IS NOT NULL
       AND jsonb_typeof(v_card -> 'damage_tags') = 'array' THEN
      FOR v_damage_tag IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_card -> 'damage_tags')
      LOOP
        IF v_damage_tag = '' THEN
          CONTINUE;
        END IF;
        IF v_damage_tag = ANY (v_seen_damage) THEN
          CONTINUE;
        END IF;
        IF v_damage_tag NOT IN (
          'crease',
          'scratching',
          'dent',
          'edge_lift',
          'edge_peeling',
          'dirt',
          'water_damage',
          'warping',
          'whitening'
        ) THEN
          RAISE EXCEPTION 'invalid damage_tag: %', v_damage_tag;
        END IF;
        v_seen_damage := array_append(v_seen_damage, v_damage_tag);
        v_damage_tags := array_append(v_damage_tags, v_damage_tag);
      END LOOP;
    END IF;

    IF coalesce(array_length(v_damage_tags, 1), 0) < 1 THEN
      RAISE EXCEPTION 'each card requires at least one damage_tag';
    END IF;

    INSERT INTO public.cards (id, order_id, card_name, set_name, description, damage_tags, is_priority)
    VALUES (
      v_card_id,
      p_order_id,
      v_card_name,
      v_set_name,
      nullif(trim(coalesce(v_card ->> 'description', '')), ''),
      v_damage_tags,
      v_card_is_priority
    )
    RETURNING * INTO v_card_row;

    INSERT INTO public.cards_original (id, order_id, card_name, set_name, description, damage_tags)
    VALUES (
      v_card_row.id,
      p_order_id,
      v_card_row.card_name,
      v_card_row.set_name,
      v_card_row.description,
      v_card_row.damage_tags
    );

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      INSERT INTO public.card_images (card_id, image_type, storage_path)
      VALUES (
        v_card_id,
        coalesce(v_image ->> 'image_type', 'customer'),
        trim(v_image ->> 'storage_path')
      )
      RETURNING * INTO v_image_row;

      INSERT INTO public.card_images_original (id, card_id, image_type, storage_path)
      VALUES (
        v_image_row.id,
        v_image_row.card_id,
        v_image_row.image_type,
        v_image_row.storage_path
      );
    END LOOP;

    v_service_keys := coalesce(v_card -> 'service_keys', '[]'::jsonb);
    IF jsonb_typeof(v_service_keys) = 'array' THEN
      v_seen_keys := '{}';
      FOR v_service_key IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_service_keys)
      LOOP
        IF v_service_key = '' THEN
          CONTINUE;
        END IF;
        IF v_service_key = ANY (v_seen_keys) THEN
          CONTINUE;
        END IF;
        v_seen_keys := array_append(v_seen_keys, v_service_key);

        -- Sync with src/lib/servicePricing.js QUOTE_SERVICES listPrice/title.
        CASE v_service_key
          WHEN 'surface_restoration' THEN
            v_service_label := 'Surface Cleaning';
            v_base_amount := 15;
          WHEN 'precision_pressing' THEN
            v_service_label := 'Minor Damage';
            v_base_amount := 30;
          WHEN 'advanced_restoration' THEN
            v_service_label := 'Major Damage';
            v_base_amount := 50;
          WHEN 'card_whitening' THEN
            v_service_label := 'Card Whitening';
            v_base_amount := 35;
          WHEN 'slab_cracking' THEN
            v_service_label := 'Slab Cracking';
            v_base_amount := 10;
          ELSE
            RAISE EXCEPTION 'invalid service_key: %', v_service_key;
        END CASE;

        INSERT INTO public.order_quote_items (
          id,
          order_id,
          sort_order,
          card_name,
          set_name,
          service_key,
          service_label,
          quote_base_amount,
          high_value_surcharge
        )
        VALUES (
          gen_random_uuid(),
          p_order_id,
          v_sort_order,
          v_card_name,
          v_set_name,
          v_service_key,
          v_service_label,
          v_base_amount,
          null
        );

        v_sort_order := v_sort_order + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public._create_order_partition(
  uuid, uuid, text, text, text, text, text, text, text, text, boolean, jsonb, jsonb
) FROM public;

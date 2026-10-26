-- Card Whitening tiers: Minor Whitening ($25) and Major Whitening ($40).
-- Sync with src/lib/servicePricing.js QUOTE_SERVICES.
--
-- card_whitening keeps its key and $25 base; its label becomes
-- "Minor Whitening". New key card_whitening_major prices at $40.
-- Existing order_quote_items rows are left unchanged; the frontend maps the
-- stored "Card Whitening" label to "Minor Whitening" for display.
--
-- _create_order_partition and create_order: same bodies as 20260924075442,
-- only the service_key allowlist, labels, and base amounts differ.

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
            v_service_label := 'Minor Whitening';
            v_base_amount := 25;
          WHEN 'card_whitening_major' THEN
            v_service_label := 'Major Whitening';
            v_base_amount := 40;
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

CREATE OR REPLACE FUNCTION public.create_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_priority_order_id uuid;
  v_user_id uuid;
  v_first_name text;
  v_last_name text;
  v_customer_name text;
  v_customer_email text;
  v_delivery_method text;
  v_heard_about_source text;
  v_preferred_type text;
  v_preferred_value text;
  v_contacts jsonb;
  v_cards jsonb;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_card_id uuid;
  v_card_name text;
  v_images jsonb;
  v_card_count int;
  v_image_count int;
  v_account_user_id uuid;
  v_profile_contacts jsonb;
  v_merged_contacts jsonb;
  v_profile_preferred_type text;
  v_account_first_name text;
  v_account_last_name text;
  v_order public.orders%rowtype;
  v_priority_order public.orders%rowtype;
  v_service_keys jsonb;
  v_service_key text;
  v_seen_keys text[] := '{}';
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_damage_raw jsonb;
  v_priority_cards jsonb;
  v_non_priority_cards jsonb;
  v_priority_count int;
  v_non_priority_count int;
  v_orders_out jsonb := '[]'::jsonb;
  v_split boolean := false;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload is required';
  END IF;

  BEGIN
    v_order_id := (p_payload ->> 'id')::uuid;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'order id must be a valid uuid';
  END;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  v_user_id := auth.uid();

  v_first_name := trim(coalesce(p_payload ->> 'first_name', ''));
  IF v_first_name = '' THEN
    RAISE EXCEPTION 'first_name is required';
  END IF;

  v_last_name := trim(coalesce(p_payload ->> 'last_name', ''));
  IF v_last_name = '' THEN
    RAISE EXCEPTION 'last_name is required';
  END IF;

  v_customer_email := trim(coalesce(p_payload ->> 'customer_email', ''));
  IF v_customer_email = '' THEN
    RAISE EXCEPTION 'customer_email is required';
  END IF;

  -- If this email (or session) already belongs to an account with a saved
  -- name, that name wins over whatever was typed on this particular
  -- submission — logged in or anonymous with a matching email.
  v_account_user_id := v_user_id;
  IF v_account_user_id IS NULL THEN
    SELECT u.id INTO v_account_user_id
    FROM auth.users u
    WHERE lower(u.email) = lower(v_customer_email)
    LIMIT 1;
  END IF;

  IF v_account_user_id IS NOT NULL THEN
    SELECT first_name, last_name INTO v_account_first_name, v_account_last_name
    FROM public.customer_profiles
    WHERE user_id = v_account_user_id;

    IF coalesce(v_account_first_name, '') <> '' THEN
      v_first_name := v_account_first_name;
    END IF;
    IF coalesce(v_account_last_name, '') <> '' THEN
      v_last_name := v_account_last_name;
    END IF;
  END IF;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.customer_profiles (user_id, first_name, last_name, updated_at)
    VALUES (v_user_id, v_first_name, v_last_name, now())
    ON CONFLICT (user_id) DO UPDATE
    SET
      first_name = CASE
        WHEN coalesce(public.customer_profiles.first_name, '') = ''
          THEN excluded.first_name
        ELSE public.customer_profiles.first_name
      END,
      last_name = CASE
        WHEN coalesce(public.customer_profiles.last_name, '') = ''
          THEN excluded.last_name
        ELSE public.customer_profiles.last_name
      END,
      updated_at = now()
    WHERE
      coalesce(public.customer_profiles.first_name, '') = ''
      OR coalesce(public.customer_profiles.last_name, '') = '';
  END IF;

  v_customer_name := trim(v_first_name || ' ' || v_last_name);

  v_delivery_method := p_payload ->> 'delivery_method';
  IF v_delivery_method IS NULL
     OR v_delivery_method NOT IN ('local_dropoff', 'shipping') THEN
    RAISE EXCEPTION 'delivery_method must be local_dropoff or shipping';
  END IF;

  v_heard_about_source := nullif(trim(coalesce(p_payload ->> 'heard_about_source', '')), '');

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  IF jsonb_typeof(v_contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts must be an array';
  END IF;

  IF jsonb_array_length(v_contacts) < 1 THEN
    RAISE EXCEPTION 'at least one additional contact is required';
  END IF;

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  IF jsonb_typeof(v_cards) <> 'array' THEN
    RAISE EXCEPTION 'cards must be an array';
  END IF;

  v_card_count := jsonb_array_length(v_cards);
  IF v_card_count < 1 THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;

  FOR v_contact IN SELECT * FROM jsonb_array_elements(v_contacts)
  LOOP
    IF coalesce(v_contact ->> 'contact_type', '') NOT IN ('phone', 'discord', 'instagram') THEN
      RAISE EXCEPTION 'invalid contact_type';
    END IF;
    IF trim(coalesce(v_contact ->> 'value', '')) = '' THEN
      RAISE EXCEPTION 'contact value is required';
    END IF;
  END LOOP;

  v_preferred_type := coalesce(nullif(trim(coalesce(p_payload ->> 'preferred_contact_type', '')), ''), 'email');
  IF v_preferred_type NOT IN ('email', 'phone', 'discord', 'instagram') THEN
    RAISE EXCEPTION 'invalid preferred_contact_type';
  END IF;

  IF v_preferred_type = 'email' THEN
    v_preferred_value := v_customer_email;
  ELSE
    v_preferred_value := trim(coalesce(p_payload ->> 'preferred_contact_value', ''));
    IF v_preferred_value = '' THEN
      RAISE EXCEPTION 'preferred_contact_value is required';
    END IF;
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT
      coalesce(contacts, '[]'::jsonb),
      nullif(trim(coalesce(preferred_contact_type, '')), '')
      INTO v_profile_contacts, v_profile_preferred_type
    FROM public.customer_profiles
    WHERE user_id = v_user_id;

    v_profile_contacts := coalesce(v_profile_contacts, '[]'::jsonb);

    SELECT coalesce(jsonb_agg(p), '[]'::jsonb)
      INTO v_profile_contacts
    FROM jsonb_array_elements(v_profile_contacts) p
    WHERE trim(coalesce(p ->> 'value', '')) <> '';

    SELECT v_profile_contacts || coalesce(jsonb_agg(
             jsonb_build_object('contact_type', s.contact_type, 'value', s.value)
           ), '[]'::jsonb)
      INTO v_merged_contacts
    FROM (
      SELECT DISTINCT ON (e ->> 'contact_type')
             e ->> 'contact_type' AS contact_type,
             trim(e ->> 'value') AS value
      FROM jsonb_array_elements(v_contacts) e
      ORDER BY e ->> 'contact_type'
    ) s
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_profile_contacts) p
      WHERE p ->> 'contact_type' = s.contact_type
    );

    IF v_merged_contacts <> v_profile_contacts OR v_profile_preferred_type IS NULL THEN
      INSERT INTO public.customer_profiles (
        user_id, contacts, preferred_contact_type, preferred_contact_value, updated_at
      )
      VALUES (
        v_user_id, v_merged_contacts, v_preferred_type, v_preferred_value, now()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET
        contacts = excluded.contacts,
        preferred_contact_type = CASE
          WHEN coalesce(public.customer_profiles.preferred_contact_type, '') = ''
            THEN excluded.preferred_contact_type
          ELSE public.customer_profiles.preferred_contact_type
        END,
        preferred_contact_value = CASE
          WHEN coalesce(public.customer_profiles.preferred_contact_type, '') = ''
            THEN excluded.preferred_contact_value
          ELSE public.customer_profiles.preferred_contact_value
        END,
        updated_at = now();
    END IF;
  END IF;

  FOR v_card IN SELECT * FROM jsonb_array_elements(v_cards)
  LOOP
    BEGIN
      v_card_id := (v_card ->> 'id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'card id must be a valid uuid';
    END;
    IF v_card_id IS NULL THEN
      RAISE EXCEPTION 'card id is required';
    END IF;

    v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
    IF v_card_name = '' THEN
      RAISE EXCEPTION 'card_name is required';
    END IF;

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    IF jsonb_typeof(v_images) <> 'array' THEN
      RAISE EXCEPTION 'card images must be an array';
    END IF;

    v_image_count := jsonb_array_length(v_images);
    IF v_image_count < 1 THEN
      RAISE EXCEPTION 'each card requires at least one image';
    END IF;

    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      IF trim(coalesce(v_image ->> 'storage_path', '')) = '' THEN
        RAISE EXCEPTION 'image storage_path is required';
      END IF;
      IF coalesce(v_image ->> 'image_type', 'customer') NOT IN ('customer', 'admin') THEN
        RAISE EXCEPTION 'invalid image_type';
      END IF;
    END LOOP;

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    IF v_card ? 'damage_tags' AND v_card -> 'damage_tags' IS NOT NULL THEN
      v_damage_raw := v_card -> 'damage_tags';
      IF jsonb_typeof(v_damage_raw) <> 'array' THEN
        RAISE EXCEPTION 'card damage_tags must be an array';
      END IF;
      FOR v_damage_tag IN
        SELECT trim(value)
        FROM jsonb_array_elements_text(v_damage_raw)
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

    IF v_card ? 'service_keys' AND v_card -> 'service_keys' IS NOT NULL THEN
      v_service_keys := v_card -> 'service_keys';
      IF jsonb_typeof(v_service_keys) <> 'array' THEN
        RAISE EXCEPTION 'card service_keys must be an array';
      END IF;

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
        IF v_service_key NOT IN (
          'surface_restoration',
          'precision_pressing',
          'advanced_restoration',
          'card_whitening',
          'card_whitening_major',
          'slab_cracking'
        ) THEN
          RAISE EXCEPTION 'invalid service_key: %', v_service_key;
        END IF;
        v_seen_keys := array_append(v_seen_keys, v_service_key);
      END LOOP;
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(c.elem ORDER BY c.ord), '[]'::jsonb)
    INTO v_priority_cards
  FROM jsonb_array_elements(v_cards) WITH ORDINALITY AS c(elem, ord)
  WHERE coalesce((c.elem ->> 'is_priority')::boolean, false);

  SELECT coalesce(jsonb_agg(c.elem ORDER BY c.ord), '[]'::jsonb)
    INTO v_non_priority_cards
  FROM jsonb_array_elements(v_cards) WITH ORDINALITY AS c(elem, ord)
  WHERE NOT coalesce((c.elem ->> 'is_priority')::boolean, false);

  v_priority_count := jsonb_array_length(v_priority_cards);
  v_non_priority_count := jsonb_array_length(v_non_priority_cards);

  IF v_priority_count > 0 AND v_non_priority_count > 0 THEN
    v_split := true;

    BEGIN
      v_priority_order_id := (p_payload ->> 'priority_order_id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'priority_order_id must be a valid uuid';
    END;

    IF v_priority_order_id IS NULL THEN
      RAISE EXCEPTION 'priority_order_id is required when cards have mixed priority';
    END IF;

    IF v_priority_order_id = v_order_id THEN
      RAISE EXCEPTION 'priority_order_id must differ from order id';
    END IF;

    v_order := public._create_order_partition(
      v_order_id,
      v_user_id,
      v_first_name,
      v_last_name,
      v_customer_name,
      v_customer_email,
      v_delivery_method,
      v_heard_about_source,
      v_preferred_type,
      v_preferred_value,
      false,
      v_contacts,
      v_non_priority_cards
    );

    v_priority_order := public._create_order_partition(
      v_priority_order_id,
      v_user_id,
      v_first_name,
      v_last_name,
      v_customer_name,
      v_customer_email,
      v_delivery_method,
      v_heard_about_source,
      v_preferred_type,
      v_preferred_value,
      true,
      v_contacts,
      v_priority_cards
    );

    v_orders_out := jsonb_build_array(
      jsonb_build_object(
        'id', v_order.id,
        'display_id', v_order.display_id,
        'is_priority', false
      ),
      jsonb_build_object(
        'id', v_priority_order.id,
        'display_id', v_priority_order.display_id,
        'is_priority', true
      )
    );
  ELSIF v_priority_count > 0 THEN
    v_order := public._create_order_partition(
      v_order_id,
      v_user_id,
      v_first_name,
      v_last_name,
      v_customer_name,
      v_customer_email,
      v_delivery_method,
      v_heard_about_source,
      v_preferred_type,
      v_preferred_value,
      true,
      v_contacts,
      v_priority_cards
    );

    v_orders_out := jsonb_build_array(
      jsonb_build_object(
        'id', v_order.id,
        'display_id', v_order.display_id,
        'is_priority', true
      )
    );
  ELSE
    v_order := public._create_order_partition(
      v_order_id,
      v_user_id,
      v_first_name,
      v_last_name,
      v_customer_name,
      v_customer_email,
      v_delivery_method,
      v_heard_about_source,
      v_preferred_type,
      v_preferred_value,
      false,
      v_contacts,
      v_non_priority_cards
    );

    v_orders_out := jsonb_build_array(
      jsonb_build_object(
        'id', v_order.id,
        'display_id', v_order.display_id,
        'is_priority', false
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'is_priority', v_order.is_priority,
    'split', v_split,
    'orders', v_orders_out
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_order(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb) TO anon, authenticated, service_role;

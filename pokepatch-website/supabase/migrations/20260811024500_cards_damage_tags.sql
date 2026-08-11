-- Persist optional customer damage tags on order cards (gallery bank).
-- Sync allowlist with src/lib/gallery.js DAMAGE_TAGS.

alter table public.cards
  add column if not exists damage_tags text[] not null default '{}'::text[];

alter table public.cards_original
  add column if not exists damage_tags text[] not null default '{}'::text[];

-- Customer quote form may send optional damage_tags per card (gallery bank).
-- Optional service_keys still create order_quote_items with server-side list prices.
-- Keep damage tag allowlist in sync with src/lib/gallery.js DAMAGE_TAGS.
-- Keep key/label/amount map in sync with src/lib/servicePricing.js (QUOTE_SERVICES).

CREATE OR REPLACE FUNCTION public.create_order(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
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
  v_set_name text;
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
  v_contact_row public.contacts%rowtype;
  v_card_row public.cards%rowtype;
  v_image_row public.card_images%rowtype;
  v_is_priority boolean;
  v_priority_fee numeric(10, 2);
  v_quote_bulk jsonb;
  v_service_keys jsonb;
  v_service_key text;
  v_service_label text;
  v_base_amount numeric(10, 2);
  v_sort_order int := 0;
  v_seen_keys text[] := '{}';
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_damage_raw jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload is required';
  end if;

  begin
    v_order_id := (p_payload ->> 'id')::uuid;
  exception
    when others then
      raise exception 'order id must be a valid uuid';
  end;

  if v_order_id is null then
    raise exception 'order id is required';
  end if;

  v_user_id := auth.uid();

  v_first_name := trim(coalesce(p_payload ->> 'first_name', ''));
  if v_first_name = '' then
    raise exception 'first_name is required';
  end if;

  v_last_name := trim(coalesce(p_payload ->> 'last_name', ''));
  if v_last_name = '' then
    raise exception 'last_name is required';
  end if;

  v_customer_email := trim(coalesce(p_payload ->> 'customer_email', ''));
  if v_customer_email = '' then
    raise exception 'customer_email is required';
  end if;

  -- If this email (or session) already belongs to an account with a saved
  -- name, that name wins over whatever was typed on this particular
  -- submission — logged in or anonymous with a matching email.
  v_account_user_id := v_user_id;
  if v_account_user_id is null then
    select u.id into v_account_user_id
    from auth.users u
    where lower(u.email) = lower(v_customer_email)
    limit 1;
  end if;

  if v_account_user_id is not null then
    select first_name, last_name into v_account_first_name, v_account_last_name
    from public.customer_profiles
    where user_id = v_account_user_id;

    -- Only override a side that the account actually has a value for — an
    -- account with just a first name saved should never blank out a
    -- genuinely-submitted last name on this new order.
    if coalesce(v_account_first_name, '') <> '' then
      v_first_name := v_account_first_name;
    end if;
    if coalesce(v_account_last_name, '') <> '' then
      v_last_name := v_account_last_name;
    end if;
  end if;

  -- If the submitter is logged in and their own account is missing a side
  -- of the name, save whatever they just typed for that side back onto the
  -- account now — otherwise a customer whose account only has a first name
  -- would be asked to retype their last name on every single quote, and
  -- their account page would stay blank even after they've told us. Never
  -- do this for an anonymous submission that merely matched an email —
  -- only the account's own logged-in session may write to its profile.
  if v_user_id is not null then
    insert into public.customer_profiles (user_id, first_name, last_name, updated_at)
    values (v_user_id, v_first_name, v_last_name, now())
    on conflict (user_id) do update
    set
      first_name = case
        when coalesce(public.customer_profiles.first_name, '') = ''
          then excluded.first_name
        else public.customer_profiles.first_name
      end,
      last_name = case
        when coalesce(public.customer_profiles.last_name, '') = ''
          then excluded.last_name
        else public.customer_profiles.last_name
      end,
      updated_at = now()
    where
      coalesce(public.customer_profiles.first_name, '') = ''
      or coalesce(public.customer_profiles.last_name, '') = '';
  end if;

  v_customer_name := trim(v_first_name || ' ' || v_last_name);

  v_delivery_method := p_payload ->> 'delivery_method';
  if v_delivery_method is null
     or v_delivery_method not in ('local_dropoff', 'shipping') then
    raise exception 'delivery_method must be local_dropoff or shipping';
  end if;

  v_heard_about_source := nullif(trim(coalesce(p_payload ->> 'heard_about_source', '')), '');

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  if jsonb_typeof(v_contacts) <> 'array' then
    raise exception 'contacts must be an array';
  end if;

  if jsonb_array_length(v_contacts) < 1 then
    raise exception 'at least one additional contact is required';
  end if;

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  if jsonb_typeof(v_cards) <> 'array' then
    raise exception 'cards must be an array';
  end if;

  v_card_count := jsonb_array_length(v_cards);
  if v_card_count < 1 then
    raise exception 'at least one card is required';
  end if;

  for v_contact in select * from jsonb_array_elements(v_contacts)
  loop
    if coalesce(v_contact ->> 'contact_type', '') not in ('phone', 'discord', 'instagram') then
      raise exception 'invalid contact_type';
    end if;
    if trim(coalesce(v_contact ->> 'value', '')) = '' then
      raise exception 'contact value is required';
    end if;
  end loop;

  v_preferred_type := coalesce(nullif(trim(coalesce(p_payload ->> 'preferred_contact_type', '')), ''), 'email');
  if v_preferred_type not in ('email', 'phone', 'discord', 'instagram') then
    raise exception 'invalid preferred_contact_type';
  end if;

  if v_preferred_type = 'email' then
    v_preferred_value := v_customer_email;
  else
    v_preferred_value := trim(coalesce(p_payload ->> 'preferred_contact_value', ''));
    if v_preferred_value = '' then
      raise exception 'preferred_contact_value is required';
    end if;
  end if;

  -- Save contact details entered on this order back onto the submitter's own
  -- account, so a customer who adds (say) a Discord handle while ordering is
  -- never asked for it again and their account page reflects it right away.
  -- Same rules as the name write-back above: only an authenticated session
  -- may write to its own profile, an anonymous submission that merely matched
  -- an email never does, and the account's existing value always wins over
  -- what was typed on the form. New contact types are added; conflicting ones
  -- are left alone.
  if v_user_id is not null then
    select
      coalesce(contacts, '[]'::jsonb),
      nullif(trim(coalesce(preferred_contact_type, '')), '')
      into v_profile_contacts, v_profile_preferred_type
    from public.customer_profiles
    where user_id = v_user_id;

    v_profile_contacts := coalesce(v_profile_contacts, '[]'::jsonb);

    -- Drop any blank entries already on the profile so they don't block the
    -- submitted value for that same contact type.
    select coalesce(jsonb_agg(p), '[]'::jsonb)
      into v_profile_contacts
    from jsonb_array_elements(v_profile_contacts) p
    where trim(coalesce(p ->> 'value', '')) <> '';

    select v_profile_contacts || coalesce(jsonb_agg(
             jsonb_build_object('contact_type', s.contact_type, 'value', s.value)
           ), '[]'::jsonb)
      into v_merged_contacts
    from (
      select distinct on (e ->> 'contact_type')
             e ->> 'contact_type' as contact_type,
             trim(e ->> 'value') as value
      from jsonb_array_elements(v_contacts) e
      order by e ->> 'contact_type'
    ) s
    where not exists (
      select 1
      from jsonb_array_elements(v_profile_contacts) p
      where p ->> 'contact_type' = s.contact_type
    );

    if v_merged_contacts <> v_profile_contacts or v_profile_preferred_type is null then
      insert into public.customer_profiles (
        user_id, contacts, preferred_contact_type, preferred_contact_value, updated_at
      )
      values (
        v_user_id, v_merged_contacts, v_preferred_type, v_preferred_value, now()
      )
      on conflict (user_id) do update
      set
        contacts = excluded.contacts,
        preferred_contact_type = case
          when coalesce(public.customer_profiles.preferred_contact_type, '') = ''
            then excluded.preferred_contact_type
          else public.customer_profiles.preferred_contact_type
        end,
        preferred_contact_value = case
          when coalesce(public.customer_profiles.preferred_contact_type, '') = ''
            then excluded.preferred_contact_value
          else public.customer_profiles.preferred_contact_value
        end,
        updated_at = now();
    end if;
  end if;

  for v_card in select * from jsonb_array_elements(v_cards)
  loop
    begin
      v_card_id := (v_card ->> 'id')::uuid;
    exception
      when others then
        raise exception 'card id must be a valid uuid';
    end;
    if v_card_id is null then
      raise exception 'card id is required';
    end if;

    v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
    if v_card_name = '' then
      raise exception 'card_name is required';
    end if;

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    if jsonb_typeof(v_images) <> 'array' then
      raise exception 'card images must be an array';
    end if;

    v_image_count := jsonb_array_length(v_images);
    if v_image_count < 1 then
      raise exception 'each card requires at least one image';
    end if;

    for v_image in select * from jsonb_array_elements(v_images)
    loop
      if trim(coalesce(v_image ->> 'storage_path', '')) = '' then
        raise exception 'image storage_path is required';
      end if;
      if coalesce(v_image ->> 'image_type', 'customer') not in ('customer', 'admin') then
        raise exception 'invalid image_type';
      end if;
    end loop;


    v_damage_tags := '{}';
    v_seen_damage := '{}';
    if v_card ? 'damage_tags' and v_card -> 'damage_tags' is not null then
      v_damage_raw := v_card -> 'damage_tags';
      if jsonb_typeof(v_damage_raw) <> 'array' then
        raise exception 'card damage_tags must be an array';
      end if;
      for v_damage_tag in
        select trim(value)
        from jsonb_array_elements_text(v_damage_raw)
      loop
        if v_damage_tag = '' then
          continue;
        end if;
        if v_damage_tag = any (v_seen_damage) then
          continue;
        end if;
        if v_damage_tag not in (
          'crease',
          'scratching',
          'dent',
          'edge_lift',
          'edge_peeling',
          'dirt',
          'water_damage',
          'warping'
        ) then
          raise exception 'invalid damage_tag: %', v_damage_tag;
        end if;
        v_seen_damage := array_append(v_seen_damage, v_damage_tag);
        v_damage_tags := array_append(v_damage_tags, v_damage_tag);
      end loop;
    end if;

    if v_card ? 'service_keys' and v_card -> 'service_keys' is not null then
      v_service_keys := v_card -> 'service_keys';
      if jsonb_typeof(v_service_keys) <> 'array' then
        raise exception 'card service_keys must be an array';
      end if;

      v_seen_keys := '{}';
      for v_service_key in
        select trim(value)
        from jsonb_array_elements_text(v_service_keys)
      loop
        if v_service_key = '' then
          continue;
        end if;
        if v_service_key = any (v_seen_keys) then
          continue;
        end if;
        if v_service_key not in (
          'surface_restoration',
          'precision_pressing',
          'advanced_restoration',
          'slab_cracking'
        ) then
          raise exception 'invalid service_key: %', v_service_key;
        end if;
        v_seen_keys := array_append(v_seen_keys, v_service_key);
      end loop;
    end if;
  end loop;

  v_is_priority := coalesce((p_payload ->> 'is_priority')::boolean, false);

  v_quote_bulk := null;
  if v_is_priority then
    v_priority_fee := (
      25 + greatest(0, v_card_count - 1) * 10
    )::numeric(10, 2);
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
  end if;

  insert into public.orders (
    id, user_id, first_name, last_name, customer_name, customer_email, delivery_method, general_notes,
    heard_about_source, preferred_contact_type, preferred_contact_value, status, pending_kind, is_priority,
    quote_bulk_counts
  )
  values (
    v_order_id, v_user_id, v_first_name, v_last_name, v_customer_name, v_customer_email, v_delivery_method, null,
    v_heard_about_source, v_preferred_type, v_preferred_value, 'pending', 'quote', v_is_priority,
    v_quote_bulk
  )
  returning * into v_order;

  insert into public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes
  )
  values (
    v_order.id,
    v_order.display_id,
    v_order.created_at,
    v_order.first_name,
    v_order.last_name,
    v_order.customer_name,
    v_order.delivery_method,
    v_order.general_notes
  );

  for v_contact in select * from jsonb_array_elements(v_contacts)
  loop
    insert into public.contacts (order_id, contact_type, value)
    values (
      v_order_id,
      v_contact ->> 'contact_type',
      trim(v_contact ->> 'value')
    )
    returning * into v_contact_row;

    insert into public.contacts_original (id, order_id, contact_type, value)
    values (
      v_contact_row.id,
      v_order_id,
      v_contact_row.contact_type,
      v_contact_row.value
    );
  end loop;

  v_sort_order := 0;

  for v_card in select * from jsonb_array_elements(v_cards)
  loop
    v_card_id := (v_card ->> 'id')::uuid;
    v_card_name := trim(v_card ->> 'card_name');
    v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    if v_card ? 'damage_tags' and v_card -> 'damage_tags' is not null
       and jsonb_typeof(v_card -> 'damage_tags') = 'array' then
      for v_damage_tag in
        select trim(value)
        from jsonb_array_elements_text(v_card -> 'damage_tags')
      loop
        if v_damage_tag = '' then
          continue;
        end if;
        if v_damage_tag = any (v_seen_damage) then
          continue;
        end if;
        if v_damage_tag not in (
          'crease',
          'scratching',
          'dent',
          'edge_lift',
          'edge_peeling',
          'dirt',
          'water_damage',
          'warping'
        ) then
          raise exception 'invalid damage_tag: %', v_damage_tag;
        end if;
        v_seen_damage := array_append(v_seen_damage, v_damage_tag);
        v_damage_tags := array_append(v_damage_tags, v_damage_tag);
      end loop;
    end if;

    insert into public.cards (id, order_id, card_name, set_name, description, damage_tags)
    values (
      v_card_id,
      v_order_id,
      v_card_name,
      v_set_name,
      nullif(trim(coalesce(v_card ->> 'description', '')), ''),
      v_damage_tags
    )
    returning * into v_card_row;

    insert into public.cards_original (id, order_id, card_name, set_name, description, damage_tags)
    values (
      v_card_row.id,
      v_order_id,
      v_card_row.card_name,
      v_card_row.set_name,
      v_card_row.description,
      v_card_row.damage_tags
    );

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    for v_image in select * from jsonb_array_elements(v_images)
    loop
      insert into public.card_images (card_id, image_type, storage_path)
      values (
        v_card_id,
        coalesce(v_image ->> 'image_type', 'customer'),
        trim(v_image ->> 'storage_path')
      )
      returning * into v_image_row;

      insert into public.card_images_original (id, card_id, image_type, storage_path)
      values (
        v_image_row.id,
        v_image_row.card_id,
        v_image_row.image_type,
        v_image_row.storage_path
      );
    end loop;

    v_service_keys := coalesce(v_card -> 'service_keys', '[]'::jsonb);
    if jsonb_typeof(v_service_keys) = 'array' then
      v_seen_keys := '{}';
      for v_service_key in
        select trim(value)
        from jsonb_array_elements_text(v_service_keys)
      loop
        if v_service_key = '' then
          continue;
        end if;
        if v_service_key = any (v_seen_keys) then
          continue;
        end if;
        v_seen_keys := array_append(v_seen_keys, v_service_key);

        -- Sync with src/lib/servicePricing.js QUOTE_SERVICES listPrice/title.
        case v_service_key
          when 'surface_restoration' then
            v_service_label := 'Surface Cleaning';
            v_base_amount := 15;
          when 'precision_pressing' then
            v_service_label := 'Flattening';
            v_base_amount := 30;
          when 'advanced_restoration' then
            v_service_label := 'Heavy Damage';
            v_base_amount := 50;
          when 'slab_cracking' then
            v_service_label := 'Slab Cracking';
            v_base_amount := 10;
          else
            raise exception 'invalid service_key: %', v_service_key;
        end case;

        insert into public.order_quote_items (
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
        values (
          gen_random_uuid(),
          v_order_id,
          v_sort_order,
          v_card_name,
          v_set_name,
          v_service_key,
          v_service_label,
          v_base_amount,
          null
        );

        v_sort_order := v_sort_order + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.create_order(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb) TO anon, authenticated, service_role;

-- Skip auto-ready when the admin explicitly changed order status on this save.
-- Also persists optional cards.damage_tags from admin saves.

CREATE OR REPLACE FUNCTION public.update_order(p_order_id uuid, p_order jsonb DEFAULT NULL::jsonb, p_contacts jsonb DEFAULT NULL::jsonb, p_cards jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_quote_item jsonb;
  v_quote_items jsonb;
  v_contact_id bigint;
  v_card_id uuid;
  v_quote_id uuid;
  v_images jsonb;
  v_contact_type text;
  v_value text;
  v_card_name text;
  v_set_name text;
  v_description text;
  v_admin_note text;
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_damage_raw jsonb;
  v_card_checklist jsonb;
  v_market_value numeric(10, 2);
  v_card_status text;
  v_prev_card_status text;
  v_card_status_changed boolean := false;
  v_status text;
  v_prev_status text;
  v_pending_kind text;
  v_image_type text;
  v_drive_url text;
  v_override_label text;
  v_override_amount numeric(10, 2);
  v_bulk_counts jsonb;
  v_service_key text;
  v_service_label text;
  v_base_amount numeric(10, 2);
  v_hv_surcharge numeric(10, 2);
  v_sort_order int;
  v_card_sort int;
  v_kept_card_ids uuid[] := '{}';
  v_order_status_manually_set boolean := false;
  v_allowed_image_types text[] := array[
    'customer', 'admin',
    'progress_front', 'progress_back',
    'final_front', 'final_back'
  ];
begin
  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  v_prev_status := v_order.status;

  if p_order is not null and jsonb_typeof(p_order) = 'object' then
    if p_order ? 'customer_name' then
      v_card_name := trim(coalesce(p_order ->> 'customer_name', ''));
      if v_card_name = '' then
        raise exception 'customer_name cannot be empty';
      end if;
      update public.orders
      set customer_name = v_card_name
      where id = p_order_id;
    end if;

    if p_order ? 'delivery_method' then
      if (p_order ->> 'delivery_method') not in ('local_dropoff', 'shipping') then
        raise exception 'delivery_method must be local_dropoff or shipping';
      end if;
      update public.orders
      set delivery_method = p_order ->> 'delivery_method'
      where id = p_order_id;
    end if;

    if p_order ? 'general_notes' then
      update public.orders
      set general_notes = nullif(trim(coalesce(p_order ->> 'general_notes', '')), '')
      where id = p_order_id;
    end if;


    if p_order ? 'is_priority' then
      update public.orders
      set is_priority = coalesce((p_order ->> 'is_priority')::boolean, false)
      where id = p_order_id;
    end if;

    if p_order ? 'photos_drive_url' then
      v_drive_url := nullif(trim(coalesce(p_order ->> 'photos_drive_url', '')), '');
      update public.orders
      set photos_drive_url = v_drive_url
      where id = p_order_id;
    end if;

    if p_order ? 'quote_bulk_counts' then
      if p_order -> 'quote_bulk_counts' is null
         or p_order ->> 'quote_bulk_counts' is null
         or p_order ->> 'quote_bulk_counts' = 'null'
         or p_order ->> 'quote_bulk_counts' = '' then
        update public.orders
        set quote_bulk_counts = null
        where id = p_order_id;
      else
        if jsonb_typeof(p_order -> 'quote_bulk_counts') <> 'object' then
          raise exception 'quote_bulk_counts must be an object';
        end if;
        v_bulk_counts := p_order -> 'quote_bulk_counts';
        update public.orders
        set quote_bulk_counts = v_bulk_counts
        where id = p_order_id;
      end if;
    end if;

    if p_order ? 'quote_override_label' or p_order ? 'quote_override_amount' then
      v_override_label := nullif(
        trim(coalesce(p_order ->> 'quote_override_label', '')),
        ''
      );

      if p_order ->> 'quote_override_amount' is null
         or trim(coalesce(p_order ->> 'quote_override_amount', '')) = '' then
        v_override_amount := null;
      else
        begin
          v_override_amount := (p_order ->> 'quote_override_amount')::numeric(10, 2);
        exception
          when others then
            raise exception 'quote_override_amount must be a number';
        end;
      end if;

      if (v_override_label is null) <> (v_override_amount is null) then
        raise exception 'quote override requires both label and amount, or neither';
      end if;

      update public.orders
      set
        quote_override_label = v_override_label,
        quote_override_amount = v_override_amount
      where id = p_order_id;
    end if;

    if p_order ? 'status' then
      v_status := p_order ->> 'status';
      if v_status = 'delivered' then
        v_status := 'completed';
      end if;
      if v_status = 'cancelled' then
        v_status := 'canceled';
      end if;
      if v_status in ('on_hold', 'pending_quote', 'pending_dropoff') then
        v_status := 'pending';
      end if;
      if v_status = 'ready_for_customer' then
        v_status := 'ready';
      end if;
      if v_status not in ('new', 'pending', 'in_progress', 'ready', 'completed', 'canceled') then
        raise exception 'invalid status';
      end if;

      if v_status is distinct from v_prev_status then
        v_order_status_manually_set := true;
      end if;

      update public.orders
      set
        status = v_status,
        pending_kind = case
          when v_status = 'pending' then coalesce(
            nullif(trim(coalesce(p_order ->> 'pending_kind', '')), ''),
            pending_kind,
            'quote'
          )
          else null
        end,
        completed_at = case
          when v_status in ('completed', 'canceled')
               and v_prev_status is distinct from v_status
               and v_prev_status not in ('completed', 'canceled')
            then now()
          when v_status in ('completed', 'canceled')
               and v_prev_status in ('completed', 'canceled')
            then completed_at
          when v_status in ('completed', 'canceled')
            then coalesce(completed_at, now())
          else null
        end
      where id = p_order_id;
    elsif p_order ? 'pending_kind' then
      if v_prev_status is distinct from 'pending'
         and v_prev_status is distinct from 'on_hold' then
        raise exception 'pending_kind only applies to pending orders';
      end if;
      v_pending_kind := trim(coalesce(p_order ->> 'pending_kind', ''));
      if v_pending_kind not in ('quote', 'drop_off') then
        raise exception 'pending_kind must be quote or drop_off';
      end if;
      update public.orders
      set pending_kind = v_pending_kind
      where id = p_order_id;
    end if;

    if p_order ? 'quote_items' then
      v_quote_items := p_order -> 'quote_items';
      if v_quote_items is null or jsonb_typeof(v_quote_items) <> 'array' then
        raise exception 'quote_items must be an array';
      end if;

      delete from public.order_quote_items qi where qi.order_id = p_order_id;

      v_sort_order := 0;
      for v_quote_item in select * from jsonb_array_elements(v_quote_items)
      loop
        v_card_name := trim(coalesce(v_quote_item ->> 'card_name', ''));
        if v_card_name = '' then
          raise exception 'quote item card_name is required';
        end if;

        v_set_name := nullif(trim(coalesce(v_quote_item ->> 'set_name', '')), '');
        v_service_key := trim(coalesce(v_quote_item ->> 'service_key', ''));
        if v_service_key = '' then
          raise exception 'quote item service_key is required';
        end if;

        v_service_label := trim(coalesce(v_quote_item ->> 'service_label', ''));
        if v_service_label = '' then
          raise exception 'quote item service_label is required';
        end if;

        begin
          v_base_amount := (v_quote_item ->> 'quote_base_amount')::numeric(10, 2);
        exception
          when others then
            raise exception 'quote item quote_base_amount must be a number';
        end;

        if v_quote_item ->> 'high_value_surcharge' is null
           or trim(coalesce(v_quote_item ->> 'high_value_surcharge', '')) = '' then
          v_hv_surcharge := null;
        else
          begin
            v_hv_surcharge := (v_quote_item ->> 'high_value_surcharge')::numeric(10, 2);
          exception
            when others then
              raise exception 'quote item high_value_surcharge must be a number';
          end;
        end if;

        v_quote_id := null;
        if v_quote_item ? 'id' and v_quote_item ->> 'id' is not null then
          begin
            v_quote_id := (v_quote_item ->> 'id')::uuid;
          exception
            when others then
              v_quote_id := null;
          end;
        end if;
        if v_quote_id is null then
          v_quote_id := gen_random_uuid();
        end if;

        insert into public.order_quote_items (
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
        values (
          v_quote_id,
          p_order_id,
          v_sort_order,
          v_card_name,
          v_set_name,
          v_service_key,
          v_service_label,
          v_base_amount,
          v_hv_surcharge
        );

        v_sort_order := v_sort_order + 1;
      end loop;
    end if;
  end if;

  if p_contacts is not null then
    if jsonb_typeof(p_contacts) <> 'array' then
      raise exception 'contacts must be an array';
    end if;

    for v_contact in select * from jsonb_array_elements(p_contacts)
    loop
      v_contact_type := v_contact ->> 'contact_type';
      v_value := trim(coalesce(v_contact ->> 'value', ''));

      if v_contact ? 'id' and v_contact ->> 'id' is not null then
        v_contact_id := (v_contact ->> 'id')::bigint;

        if not exists (
          select 1 from public.contacts
          where id = v_contact_id and order_id = p_order_id
        ) then
          raise exception 'contact % not found on order', v_contact_id;
        end if;

        if v_contact ? 'contact_type'
           and v_contact_type not in ('phone', 'discord', 'instagram') then
          raise exception 'invalid contact_type';
        end if;
        if v_contact ? 'value' and v_value = '' then
          raise exception 'contact value cannot be empty';
        end if;

        update public.contacts
        set
          contact_type = coalesce(v_contact_type, contact_type),
          value = case when v_contact ? 'value' then v_value else value end
        where id = v_contact_id;
      else
        if v_contact_type is null
           or v_contact_type not in ('phone', 'discord', 'instagram') then
          raise exception 'invalid contact_type';
        end if;
        if v_value = '' then
          raise exception 'contact value is required';
        end if;

        insert into public.contacts (order_id, contact_type, value)
        values (p_order_id, v_contact_type, v_value);
      end if;
    end loop;
  end if;

  if p_cards is not null then
    if jsonb_typeof(p_cards) <> 'array' then
      raise exception 'cards must be an array';
    end if;

    v_card_sort := 0;
    for v_card in select * from jsonb_array_elements(p_cards)
    loop
      v_images := coalesce(v_card -> 'images', '[]'::jsonb);

      v_card_id := null;
      if v_card ? 'id' and v_card ->> 'id' is not null then
        begin
          v_card_id := (v_card ->> 'id')::uuid;
        exception
          when others then
            raise exception 'card id must be a valid uuid';
        end;
      end if;

      if v_card_id is not null and exists (
        select 1 from public.cards
        where id = v_card_id and order_id = p_order_id
      ) then
        if v_card ? 'card_name' then
          v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
          if v_card_name = '' then
            raise exception 'card_name cannot be empty';
          end if;
          update public.cards set card_name = v_card_name where id = v_card_id;
        end if;

        if v_card ? 'set_name' then
          update public.cards
          set set_name = nullif(trim(coalesce(v_card ->> 'set_name', '')), '')
          where id = v_card_id;
        end if;

        if v_card ? 'description' then
          update public.cards
          set description = nullif(trim(coalesce(v_card ->> 'description', '')), '')
          where id = v_card_id;
        end if;

        if v_card ? 'damage_tags' then
          v_damage_tags := '{}';
          v_seen_damage := '{}';
          if v_card -> 'damage_tags' is null then
            v_damage_tags := '{}';
          else
            v_damage_raw := v_card -> 'damage_tags';
            if jsonb_typeof(v_damage_raw) <> 'array' then
              raise exception 'card damage_tags must be an array';
            end if;
            for v_damage_tag in
              select trim(value)
              from jsonb_array_elements_text(v_damage_raw)
            loop
              if v_damage_tag = '' then
                continue;
              end if;
              if v_damage_tag = any (v_seen_damage) then
                continue;
              end if;
              if v_damage_tag not in (
                'crease',
                'scratching',
                'dent',
                'edge_lift',
                'edge_peeling',
                'dirt',
                'water_damage',
                'warping'
              ) then
                raise exception 'invalid damage_tag: %', v_damage_tag;
              end if;
              v_seen_damage := array_append(v_seen_damage, v_damage_tag);
              v_damage_tags := array_append(v_damage_tags, v_damage_tag);
            end loop;
          end if;
          update public.cards
          set damage_tags = v_damage_tags
          where id = v_card_id;
        end if;

        if v_card ? 'admin_note' then
          update public.cards
          set admin_note = nullif(trim(coalesce(v_card ->> 'admin_note', '')), '')
          where id = v_card_id;
        end if;

        if v_card ? 'market_value_raw_nm' then
          if v_card ->> 'market_value_raw_nm' is null
             or trim(coalesce(v_card ->> 'market_value_raw_nm', '')) = '' then
            v_market_value := null;
          else
            begin
              v_market_value := (v_card ->> 'market_value_raw_nm')::numeric(10, 2);
            exception
              when others then
                raise exception 'card market_value_raw_nm must be a number';
            end;
            if v_market_value < 0 then
              raise exception 'card market_value_raw_nm cannot be negative';
            end if;
          end if;
          update public.cards
          set market_value_raw_nm = v_market_value
          where id = v_card_id;
        end if;

        if v_card ? 'status' then
          v_card_status := trim(coalesce(v_card ->> 'status', ''));
          if v_card_status = 'new' then
            v_card_status := 'todo';
          end if;
          if v_card_status = 'cancelled' then
            v_card_status := 'canceled';
          end if;
          if v_card_status not in ('todo', 'in_progress', 'completed', 'canceled') then
            raise exception 'invalid card status';
          end if;
          select status into v_prev_card_status
          from public.cards
          where id = v_card_id;
          if v_prev_card_status is distinct from v_card_status then
            v_card_status_changed := true;
          end if;
          update public.cards
          set status = v_card_status
          where id = v_card_id;
        end if;

        if v_card ? 'checklist' then
          if jsonb_typeof(v_card -> 'checklist') <> 'object' then
            raise exception 'card checklist must be an object';
          end if;
          update public.cards
          set checklist = v_card -> 'checklist'
          where id = v_card_id;
        end if;
      else
        if v_card_id is null then
          v_card_id := gen_random_uuid();
        end if;

        v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
        if v_card_name = '' then
          raise exception 'card_name is required';
        end if;

        v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');
        v_description := nullif(trim(coalesce(v_card ->> 'description', '')), '');
        v_admin_note := nullif(trim(coalesce(v_card ->> 'admin_note', '')), '');

        v_damage_tags := '{}';
        v_seen_damage := '{}';
        if v_card ? 'damage_tags' and v_card -> 'damage_tags' is not null then
          v_damage_raw := v_card -> 'damage_tags';
          if jsonb_typeof(v_damage_raw) <> 'array' then
            raise exception 'card damage_tags must be an array';
          end if;
          for v_damage_tag in
            select trim(value)
            from jsonb_array_elements_text(v_damage_raw)
          loop
            if v_damage_tag = '' then
              continue;
            end if;
            if v_damage_tag = any (v_seen_damage) then
              continue;
            end if;
            if v_damage_tag not in (
              'crease',
              'scratching',
              'dent',
              'edge_lift',
              'edge_peeling',
              'dirt',
              'water_damage',
              'warping'
            ) then
              raise exception 'invalid damage_tag: %', v_damage_tag;
            end if;
            v_seen_damage := array_append(v_seen_damage, v_damage_tag);
            v_damage_tags := array_append(v_damage_tags, v_damage_tag);
          end loop;
        end if;

        if v_card ->> 'market_value_raw_nm' is null
           or trim(coalesce(v_card ->> 'market_value_raw_nm', '')) = '' then
          v_market_value := null;
        else
          begin
            v_market_value := (v_card ->> 'market_value_raw_nm')::numeric(10, 2);
          exception
            when others then
              raise exception 'card market_value_raw_nm must be a number';
          end;
          if v_market_value < 0 then
            raise exception 'card market_value_raw_nm cannot be negative';
          end if;
        end if;

        v_card_status := trim(coalesce(v_card ->> 'status', 'todo'));
        if v_card_status = '' then
          v_card_status := 'todo';
        end if;
        if v_card_status = 'new' then
          v_card_status := 'todo';
        end if;
        if v_card_status = 'cancelled' then
          v_card_status := 'canceled';
        end if;
        if v_card_status not in ('todo', 'in_progress', 'completed', 'canceled') then
          raise exception 'invalid card status';
        end if;

        if v_card ? 'checklist' and jsonb_typeof(v_card -> 'checklist') = 'object' then
          v_card_checklist := v_card -> 'checklist';
        else
          v_card_checklist := '{}'::jsonb;
        end if;

        insert into public.cards (
          id,
          order_id,
          card_name,
          set_name,
          description,
          damage_tags,
          admin_note,
          market_value_raw_nm,
          status,
          sort_order,
          checklist
        )
        values (
          v_card_id,
          p_order_id,
          v_card_name,
          v_set_name,
          v_description,
          v_damage_tags,
          v_admin_note,
          v_market_value,
          v_card_status,
          v_card_sort,
          v_card_checklist
        );
      end if;

      update public.cards
      set sort_order = v_card_sort
      where id = v_card_id;

      v_kept_card_ids := array_append(v_kept_card_ids, v_card_id);
      v_card_sort := v_card_sort + 1;

      if jsonb_typeof(v_images) = 'array' then
        for v_image in select * from jsonb_array_elements(v_images)
        loop
          if trim(coalesce(v_image ->> 'storage_path', '')) = '' then
            raise exception 'image storage_path is required';
          end if;
          v_image_type := coalesce(v_image ->> 'image_type', 'customer');
          if not (v_image_type = any(v_allowed_image_types)) then
            raise exception 'invalid image_type';
          end if;

          insert into public.card_images (card_id, image_type, storage_path)
          values (
            v_card_id,
            v_image_type,
            trim(v_image ->> 'storage_path')
          );
        end loop;
      end if;
    end loop;

    delete from public.cards c
    where c.order_id = p_order_id
      and not (c.id = any (v_kept_card_ids));
  end if;

  perform public.maybe_auto_pending_dropoff(p_order_id);


  -- Auto-advance to ready when every card is completed, unless status was edited this save.
  if not v_order_status_manually_set then
    select status into v_status from public.orders where id = p_order_id;
    if v_status not in ('ready', 'completed', 'canceled') then
      if exists (
        select 1
        from public.cards c
        where c.order_id = p_order_id
      ) and not exists (
        select 1
        from public.cards c
        where c.order_id = p_order_id
          and c.status is distinct from 'completed'
      ) then
        update public.orders
        set
          status = 'ready',
          pending_kind = null,
          status_changed_at = now()
        where id = p_order_id;
      end if;
    end if;
  end if;

  select * into v_order from public.orders where id = p_order_id;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes,
    'photos_drive_url', v_order.photos_drive_url,
    'status', v_order.status,
    'pending_kind', v_order.pending_kind,
    'completed_at', v_order.completed_at,
    'quote_bulk_counts', v_order.quote_bulk_counts,
    'quote_override_label', v_order.quote_override_label,
    'quote_override_amount', v_order.quote_override_amount,
    'is_priority', v_order.is_priority
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.update_order(uuid, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_order(uuid, jsonb, jsonb, jsonb) TO service_role;

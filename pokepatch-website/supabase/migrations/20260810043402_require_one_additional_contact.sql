-- Require at least one additional contact (phone, discord, or instagram)
-- on quote submission, in addition to email.
--
-- Function body is the live definition from 20260807084906 with one new
-- guard after the contacts array type check.

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

  for v_card in select * from jsonb_array_elements(v_cards)
  loop
    v_card_id := (v_card ->> 'id')::uuid;

    insert into public.cards (id, order_id, card_name, set_name, description)
    values (
      v_card_id,
      v_order_id,
      trim(v_card ->> 'card_name'),
      nullif(trim(coalesce(v_card ->> 'set_name', '')), ''),
      nullif(trim(coalesce(v_card ->> 'description', '')), '')
    )
    returning * into v_card_row;

    insert into public.cards_original (id, order_id, card_name, set_name, description)
    values (
      v_card_row.id,
      v_order_id,
      v_card_row.card_name,
      v_card_row.set_name,
      v_card_row.description
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

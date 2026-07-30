-- Split customer name into separate first/last name columns.
-- customer_name stays as a derived "first last" value so existing readers
-- (admin UI, notify emails, other RPCs) keep working unchanged.

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

ALTER TABLE public.orders_original
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

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
  v_order public.orders%rowtype;
  v_contact_row public.contacts%rowtype;
  v_card_row public.cards%rowtype;
  v_image_row public.card_images%rowtype;
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

  v_customer_name := v_first_name || ' ' || v_last_name;

  v_customer_email := trim(coalesce(p_payload ->> 'customer_email', ''));
  if v_customer_email = '' then
    raise exception 'customer_email is required';
  end if;

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

  insert into public.orders (
    id, user_id, first_name, last_name, customer_name, customer_email, delivery_method, general_notes,
    heard_about_source, preferred_contact_type, preferred_contact_value, status, pending_kind
  )
  values (
    v_order_id, v_user_id, v_first_name, v_last_name, v_customer_name, v_customer_email, v_delivery_method, null,
    v_heard_about_source, v_preferred_type, v_preferred_value, 'pending', 'quote'
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

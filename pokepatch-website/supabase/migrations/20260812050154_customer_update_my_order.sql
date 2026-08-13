-- Customer My Orders overhaul:
-- - strip market_value from get_my_order
-- - add update_my_order / cancel_my_order / send_my_order_message
-- - customer_messages.sender (admin|customer)
-- - unread count ignores customer-authored rows

-- ---------------------------------------------------------------------------
-- sender column
-- ---------------------------------------------------------------------------
alter table public.customer_messages
  add column if not exists sender text;

update public.customer_messages
set sender = 'admin'
where sender is null;

alter table public.customer_messages
  alter column sender set default 'admin';

alter table public.customer_messages
  alter column sender set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_messages_sender_check'
  ) then
    alter table public.customer_messages
      add constraint customer_messages_sender_check
      check (sender = any (array['admin'::text, 'customer'::text]));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unread count: only admin → customer messages
-- ---------------------------------------------------------------------------
create or replace function public.get_my_unread_message_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.customer_messages cm
  where cm.read_at is null
    and coalesce(cm.sender, 'admin') = 'admin'
    and (
      cm.user_id = auth.uid()
      or exists (
        select 1
        from public.orders o
        where o.id = cm.order_id
          and o.user_id = auth.uid()
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- get_my_order: no market_value; include pending_kind
-- ---------------------------------------------------------------------------
create or replace function public.get_my_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_contacts jsonb;
  v_cards jsonb;
  v_quote_items jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id;

  if not found then
    raise exception 'order not found or access denied';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'contact_type', c.contact_type,
      'value', c.value
    )
    order by c.id
  ) into v_contacts
  from public.contacts c
  where c.order_id = v_order.id;

  select jsonb_agg(
    jsonb_build_object(
      'id', card.id,
      'card_name', card.card_name,
      'set_name', card.set_name,
      'description', card.description,
      'damage_tags', coalesce(card.damage_tags, '{}'::text[]),
      'admin_note', card.admin_note,
      'status', card.status,
      'queue_position', (
        select q.queue_position
        from (
          select
            c2.id as card_id,
            row_number() over (
              order by
                o2.is_priority desc,
                o2.created_at asc nulls last,
                c2.id asc
            )::integer as queue_position
          from public.cards c2
          inner join public.orders o2 on o2.id = c2.order_id
          where o2.status = 'new'
            and c2.status in ('todo', 'in_progress')
        ) q
        where q.card_id = card.id
          and v_order.status = 'new'
          and card.status in ('todo', 'in_progress')
      ),
      'images', (
        select jsonb_agg(
          jsonb_build_object(
            'id', ci.id,
            'image_type', ci.image_type,
            'storage_path', ci.storage_path
          )
          order by ci.id
        )
        from public.card_images ci
        where ci.card_id = card.id
      )
    )
    order by card.sort_order, card.id
  ) into v_cards
  from public.cards card
  where card.order_id = v_order.id;

  select jsonb_agg(
    jsonb_build_object(
      'id', qi.id,
      'sort_order', qi.sort_order,
      'card_name', qi.card_name,
      'set_name', qi.set_name,
      'service_key', qi.service_key,
      'service_label', qi.service_label,
      'quote_base_amount', qi.quote_base_amount,
      'high_value_surcharge', qi.high_value_surcharge
    )
    order by qi.sort_order, qi.id
  ) into v_quote_items
  from public.order_quote_items qi
  where qi.order_id = v_order.id;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'customer_email', v_order.customer_email,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes,
    'photos_drive_url', v_order.photos_drive_url,
    'preferred_contact_type', v_order.preferred_contact_type,
    'preferred_contact_value', v_order.preferred_contact_value,
    'quote_bulk_counts', v_order.quote_bulk_counts,
    'quote_override_label', v_order.quote_override_label,
    'quote_override_amount', v_order.quote_override_amount,
    'is_priority', v_order.is_priority,
    'status', v_order.status,
    'pending_kind', v_order.pending_kind,
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_my_order(uuid) from public;
grant execute on function public.get_my_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: insert an in-app customer→admin message (no email)
-- ---------------------------------------------------------------------------
create or replace function public._insert_customer_order_message(
  p_order public.orders,
  p_subject text,
  p_body text,
  p_changelog jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_email text;
begin
  v_email := coalesce(nullif(trim(p_order.customer_email), ''), 'unknown@invalid');

  insert into public.customer_messages (
    order_id,
    recipient_email,
    user_id,
    subject,
    body,
    changelog,
    email_status,
    batch_id,
    sender,
    read_at
  )
  values (
    p_order.id,
    v_email,
    p_order.user_id,
    coalesce(nullif(trim(p_subject), ''), 'Order update'),
    coalesce(p_body, ''),
    p_changelog,
    'sent',
    gen_random_uuid(),
    'customer',
    now()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public._insert_customer_order_message(public.orders, text, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- update_my_order
-- ---------------------------------------------------------------------------
create or replace function public.update_my_order(
  p_order_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_before jsonb;
  v_delivery_method text;
  v_preferred_type text;
  v_preferred_value text;
  v_is_priority boolean;
  v_contacts jsonb;
  v_cards jsonb;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_card_id uuid;
  v_card_name text;
  v_set_name text;
  v_description text;
  v_images jsonb;
  v_card_count int;
  v_image_count int;
  v_customer_image_count int;
  v_damage_tags text[] := '{}';
  v_damage_tag text;
  v_seen_damage text[] := '{}';
  v_damage_raw jsonb;
  v_kept_card_ids uuid[] := '{}';
  v_kept_image_ids bigint[] := '{}';
  v_sort_order int := 0;
  v_existing_card public.cards%rowtype;
  v_image_id bigint;
  v_storage_path text;
  v_path_prefix text;
  v_order_changes jsonb := '[]'::jsonb;
  v_card_groups jsonb := '[]'::jsonb;
  v_changelog jsonb;
  v_label text;
  v_before_card jsonb;
  v_after_card jsonb;
  v_after jsonb;
  v_card_changes text[];
  v_before_contacts text;
  v_after_contacts text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload is required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'order not found or access denied';
  end if;

  if v_order.status is distinct from 'pending' then
    raise exception 'order can only be edited while pending';
  end if;

  v_before := public.get_my_order(p_order_id);

  v_delivery_method := coalesce(
    p_payload ->> 'delivery_method',
    v_order.delivery_method
  );
  if v_delivery_method not in ('local_dropoff', 'shipping') then
    raise exception 'delivery_method must be local_dropoff or shipping';
  end if;

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  if jsonb_typeof(v_contacts) <> 'array' then
    raise exception 'contacts must be an array';
  end if;
  if jsonb_array_length(v_contacts) < 1 then
    raise exception 'at least one additional contact is required';
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

  v_preferred_type := coalesce(
    nullif(trim(coalesce(p_payload ->> 'preferred_contact_type', '')), ''),
    coalesce(v_order.preferred_contact_type, 'email')
  );
  if v_preferred_type not in ('email', 'phone', 'discord', 'instagram') then
    raise exception 'invalid preferred_contact_type';
  end if;

  if v_preferred_type = 'email' then
    v_preferred_value := v_order.customer_email;
  else
    v_preferred_value := trim(coalesce(p_payload ->> 'preferred_contact_value', ''));
    if v_preferred_value = '' then
      -- Fall back to matching contact value from payload.
      select trim(c ->> 'value') into v_preferred_value
      from jsonb_array_elements(v_contacts) c
      where c ->> 'contact_type' = v_preferred_type
        and trim(coalesce(c ->> 'value', '')) <> ''
      limit 1;
    end if;
    if coalesce(v_preferred_value, '') = '' then
      raise exception 'preferred_contact_value is required';
    end if;
  end if;

  v_is_priority := coalesce(
    (p_payload ->> 'is_priority')::boolean,
    v_order.is_priority,
    false
  );

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  if jsonb_typeof(v_cards) <> 'array' then
    raise exception 'cards must be an array';
  end if;

  v_card_count := jsonb_array_length(v_cards);
  if v_card_count < 1 then
    raise exception 'at least one card is required';
  end if;
  if v_card_count > 25 then
    raise exception 'at most 25 cards allowed';
  end if;

  -- Validate all cards before mutating.
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
    if v_image_count > 4 then
      raise exception 'each card allows at most 4 customer images';
    end if;

    v_path_prefix := 'order-' || p_order_id::text || '/card-' || v_card_id::text || '/';
    for v_image in select * from jsonb_array_elements(v_images)
    loop
      v_storage_path := trim(coalesce(v_image ->> 'storage_path', ''));
      if v_storage_path = '' then
        raise exception 'image storage_path is required';
      end if;
      if position(v_path_prefix in v_storage_path) <> 1 then
        raise exception 'image storage_path must belong to this order card';
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
          'warping',
          'whitening'
        ) then
          raise exception 'invalid damage_tag: %', v_damage_tag;
        end if;
        v_seen_damage := array_append(v_seen_damage, v_damage_tag);
        v_damage_tags := array_append(v_damage_tags, v_damage_tag);
      end loop;
    end if;

    if coalesce(array_length(v_damage_tags, 1), 0) < 1 then
      raise exception 'each card requires at least one damage_tag';
    end if;
  end loop;

  -- Order-level fields (never touch quote columns).
  update public.orders
  set
    delivery_method = v_delivery_method,
    preferred_contact_type = v_preferred_type,
    preferred_contact_value = v_preferred_value,
    is_priority = v_is_priority
  where id = p_order_id;

  -- Replace contacts.
  delete from public.contacts where order_id = p_order_id;
  for v_contact in select * from jsonb_array_elements(v_contacts)
  loop
    insert into public.contacts (order_id, contact_type, value)
    values (
      p_order_id,
      v_contact ->> 'contact_type',
      trim(v_contact ->> 'value')
    );
  end loop;

  -- Sync cards.
  v_sort_order := 0;
  for v_card in select * from jsonb_array_elements(v_cards)
  loop
    v_card_id := (v_card ->> 'id')::uuid;
    v_card_name := trim(v_card ->> 'card_name');
    v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');
    v_description := nullif(trim(coalesce(v_card ->> 'description', '')), '');

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    for v_damage_tag in
      select trim(value)
      from jsonb_array_elements_text(coalesce(v_card -> 'damage_tags', '[]'::jsonb))
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
        'warping',
        'whitening'
      ) then
        raise exception 'invalid damage_tag: %', v_damage_tag;
      end if;
      v_seen_damage := array_append(v_seen_damage, v_damage_tag);
      v_damage_tags := array_append(v_damage_tags, v_damage_tag);
    end loop;

    select * into v_existing_card
    from public.cards
    where id = v_card_id and order_id = p_order_id;

    if found then
      update public.cards
      set
        card_name = v_card_name,
        set_name = v_set_name,
        description = v_description,
        damage_tags = v_damage_tags,
        sort_order = v_sort_order
      where id = v_card_id;
    else
      insert into public.cards (
        id, order_id, card_name, set_name, description, damage_tags, sort_order
      )
      values (
        v_card_id,
        p_order_id,
        v_card_name,
        v_set_name,
        v_description,
        v_damage_tags,
        v_sort_order
      );
    end if;

    v_kept_card_ids := array_append(v_kept_card_ids, v_card_id);

    -- Sync customer images only.
    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    v_kept_image_ids := '{}';
    v_customer_image_count := 0;

    for v_image in select * from jsonb_array_elements(v_images)
    loop
      v_storage_path := trim(v_image ->> 'storage_path');
      v_image_id := null;
      if v_image ? 'id' and nullif(trim(coalesce(v_image ->> 'id', '')), '') is not null then
        begin
          v_image_id := (v_image ->> 'id')::bigint;
        exception
          when others then
            v_image_id := null;
        end;
      end if;

      if v_image_id is not null then
        if exists (
          select 1
          from public.card_images ci
          where ci.id = v_image_id
            and ci.card_id = v_card_id
            and ci.image_type = 'customer'
        ) then
          update public.card_images
          set storage_path = v_storage_path
          where id = v_image_id;
          v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
          v_customer_image_count := v_customer_image_count + 1;
          continue;
        end if;
      end if;

      -- Reuse existing row with same path when possible.
      select ci.id into v_image_id
      from public.card_images ci
      where ci.card_id = v_card_id
        and ci.image_type = 'customer'
        and ci.storage_path = v_storage_path
      limit 1;

      if v_image_id is not null then
        v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
        v_customer_image_count := v_customer_image_count + 1;
      else
        insert into public.card_images (card_id, image_type, storage_path)
        values (v_card_id, 'customer', v_storage_path)
        returning id into v_image_id;
        v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
        v_customer_image_count := v_customer_image_count + 1;
      end if;
    end loop;

    if v_customer_image_count < 1 then
      raise exception 'each card requires at least one customer image';
    end if;

    delete from public.card_images ci
    where ci.card_id = v_card_id
      and ci.image_type = 'customer'
      and not (ci.id = any (v_kept_image_ids));

    v_sort_order := v_sort_order + 1;
  end loop;

  delete from public.cards
  where order_id = p_order_id
    and not (id = any (v_kept_card_ids));

  select * into v_order from public.orders where id = p_order_id;
  v_after := public.get_my_order(p_order_id);

  -- Build a customer-facing changelog for admin visibility.
  if coalesce(v_before ->> 'delivery_method', '') is distinct from v_order.delivery_method then
    v_order_changes := v_order_changes || jsonb_build_array(
      format(
        'Delivery: %s → %s',
        case coalesce(v_before ->> 'delivery_method', '')
          when 'local_dropoff' then 'Local Drop-Off'
          when 'shipping' then 'Shipping'
          else coalesce(v_before ->> 'delivery_method', '—')
        end,
        case v_order.delivery_method
          when 'local_dropoff' then 'Local Drop-Off'
          when 'shipping' then 'Shipping'
          else v_order.delivery_method
        end
      )
    );
  end if;

  if coalesce((v_before ->> 'is_priority')::boolean, false) is distinct from v_order.is_priority then
    v_order_changes := v_order_changes || jsonb_build_array(
      case
        when v_order.is_priority then 'Added: Priority service'
        else 'Removed: Priority service'
      end
    );
  end if;

  select string_agg(contact_type || ':' || value, ',' order by contact_type, value)
    into v_before_contacts
  from jsonb_to_recordset(coalesce(v_before -> 'contacts', '[]'::jsonb))
    as x(contact_type text, value text);

  select string_agg(contact_type || ':' || value, ',' order by contact_type, value)
    into v_after_contacts
  from public.contacts
  where order_id = p_order_id;

  if coalesce(v_before_contacts, '') is distinct from coalesce(v_after_contacts, '') then
    v_order_changes := v_order_changes || jsonb_build_array('Updated contacts');
  end if;

  if coalesce(v_before ->> 'preferred_contact_type', '') is distinct from coalesce(v_order.preferred_contact_type, '')
     or coalesce(v_before ->> 'preferred_contact_value', '') is distinct from coalesce(v_order.preferred_contact_value, '') then
    v_order_changes := v_order_changes || jsonb_build_array('Updated preferred contact');
  end if;

  -- Card groups: added / removed / modified (customer-visible fields + photos).
  for v_before_card in
    select value
    from jsonb_array_elements(coalesce(v_before -> 'cards', '[]'::jsonb))
  loop
    if not exists (
      select 1
      from unnest(v_kept_card_ids) kid
      where kid = (v_before_card ->> 'id')::uuid
    ) then
      v_label := trim(coalesce(v_before_card ->> 'card_name', 'Card'));
      if nullif(trim(coalesce(v_before_card ->> 'set_name', '')), '') is not null then
        v_label := v_label || ' (' || trim(v_before_card ->> 'set_name') || ')';
      end if;
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_before_card ->> 'id',
          'label', v_label,
          'status', 'removed',
          'sortIndex', 1000,
          'changes', '[]'::jsonb
        )
      );
    end if;
  end loop;

  for v_after_card in
    select value
    from jsonb_array_elements(coalesce(v_after -> 'cards', '[]'::jsonb))
  loop
    v_before_card := null;
    select value into v_before_card
    from jsonb_array_elements(coalesce(v_before -> 'cards', '[]'::jsonb)) value
    where value ->> 'id' = v_after_card ->> 'id'
    limit 1;

    v_label := trim(coalesce(v_after_card ->> 'card_name', 'Card'));
    if nullif(trim(coalesce(v_after_card ->> 'set_name', '')), '') is not null then
      v_label := v_label || ' (' || trim(v_after_card ->> 'set_name') || ')';
    end if;

    if v_before_card is null then
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_after_card ->> 'id',
          'label', v_label,
          'status', 'added',
          'sortIndex', 0,
          'changes', '[]'::jsonb
        )
      );
      continue;
    end if;

    v_card_changes := '{}';
    if coalesce(v_before_card ->> 'card_name', '') is distinct from coalesce(v_after_card ->> 'card_name', '') then
      v_card_changes := array_append(
        v_card_changes,
        format('Name: %s → %s', coalesce(v_before_card ->> 'card_name', '—'), coalesce(v_after_card ->> 'card_name', '—'))
      );
    end if;
    if coalesce(v_before_card ->> 'set_name', '') is distinct from coalesce(v_after_card ->> 'set_name', '') then
      v_card_changes := array_append(
        v_card_changes,
        format('Set: %s → %s', coalesce(nullif(v_before_card ->> 'set_name', ''), '—'), coalesce(nullif(v_after_card ->> 'set_name', ''), '—'))
      );
    end if;
    if coalesce(v_before_card ->> 'description', '') is distinct from coalesce(v_after_card ->> 'description', '') then
      v_card_changes := array_append(v_card_changes, 'Updated description');
    end if;
    if coalesce(v_before_card -> 'damage_tags', '[]'::jsonb) is distinct from coalesce(v_after_card -> 'damage_tags', '[]'::jsonb) then
      v_card_changes := array_append(v_card_changes, 'Updated damage tags');
    end if;
    if (
      select coalesce(jsonb_agg(i ->> 'storage_path' order by i ->> 'storage_path'), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_before_card -> 'images', '[]'::jsonb)) i
      where coalesce(i ->> 'image_type', 'customer') = 'customer'
    ) is distinct from (
      select coalesce(jsonb_agg(i ->> 'storage_path' order by i ->> 'storage_path'), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_after_card -> 'images', '[]'::jsonb)) i
      where coalesce(i ->> 'image_type', 'customer') = 'customer'
    ) then
      v_card_changes := array_append(v_card_changes, 'Updated photos');
    end if;

    if coalesce(array_length(v_card_changes, 1), 0) > 0 then
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_after_card ->> 'id',
          'label', v_label,
          'status', 'modified',
          'sortIndex', 100,
          'changes', to_jsonb(v_card_changes)
        )
      );
    end if;
  end loop;

  if jsonb_array_length(v_order_changes) > 0 or jsonb_array_length(v_card_groups) > 0 then
    v_changelog := jsonb_build_object(
      'cardGroups', v_card_groups,
      'orderChanges', v_order_changes,
      'quoteSummary', null
    );

    perform public._insert_customer_order_message(
      v_order,
      'Customer updated order #' || v_order.display_id::text,
      'The customer updated this order while it was still pending.',
      v_changelog
    );
  end if;

  return v_after;
end;
$function$;

revoke all on function public.update_my_order(uuid, jsonb) from public;
grant execute on function public.update_my_order(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_my_order
-- ---------------------------------------------------------------------------
create or replace function public.cancel_my_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_prev_status text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'order not found or access denied';
  end if;

  if v_order.status is distinct from 'pending' then
    raise exception 'order can only be canceled while pending';
  end if;

  v_prev_status := v_order.status;

  update public.orders
  set
    status = 'canceled',
    pending_kind = null,
    completed_at = now(),
    status_changed_at = now()
  where id = p_order_id;

  select * into v_order from public.orders where id = p_order_id;

  perform public._insert_customer_order_message(
    v_order,
    'Customer canceled order #' || v_order.display_id::text,
    'The customer canceled this order while it was still pending.',
    jsonb_build_object(
      'cardGroups', '[]'::jsonb,
      'orderChanges', jsonb_build_array(
        format(
          'Status: %s → Canceled',
          case
            when v_prev_status = 'pending' then 'Pending'
            else v_prev_status
          end
        )
      ),
      'quoteSummary', null
    )
  );

  return public.get_my_order(p_order_id);
end;
$function$;

revoke all on function public.cancel_my_order(uuid) from public;
grant execute on function public.cancel_my_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- send_my_order_message
-- ---------------------------------------------------------------------------
create or replace function public.send_my_order_message(
  p_order_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_body text;
  v_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then
    raise exception 'message body is required';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'message body is too long';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id;

  if not found then
    raise exception 'order not found or access denied';
  end if;

  v_id := public._insert_customer_order_message(
    v_order,
    'Message from customer · Order #' || v_order.display_id::text,
    v_body,
    null
  );

  return jsonb_build_object(
    'id', v_id,
    'order_id', p_order_id,
    'sender', 'customer',
    'subject', 'Message from customer · Order #' || v_order.display_id::text,
    'body', v_body,
    'sent_at', now(),
    'read_at', now()
  );
end;
$function$;

revoke all on function public.send_my_order_message(uuid, text) from public;
grant execute on function public.send_my_order_message(uuid, text) to authenticated;

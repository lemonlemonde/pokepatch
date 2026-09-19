-- When a customer removes cards via update_my_order, also drop matching
-- order_quote_items and prune quote_bulk_counts.card_hv for removed card ids.
-- Admin remove already filtered quote lines client-side; customer path did not.

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

  -- Drop quote lines whose name/set no longer match any remaining card
  -- (same soft link admin UI uses). Prevents orphan quotes after customer
  -- removes cards.
  delete from public.order_quote_items qi
  where qi.order_id = p_order_id
    and not exists (
      select 1
      from public.cards c
      where c.order_id = p_order_id
        and lower(trim(c.card_name)) = lower(trim(qi.card_name))
        and lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
    );

  -- Prune high-value surcharge map entries for removed card ids.
  update public.orders o
  set quote_bulk_counts = case
    when o.quote_bulk_counts is null then null
    when jsonb_typeof(o.quote_bulk_counts -> 'card_hv') is distinct from 'array' then o.quote_bulk_counts
    else (
      select case
        when jsonb_array_length(coalesce(o.quote_bulk_counts -> 'adjustments', '[]'::jsonb)) = 0
             and coalesce(jsonb_array_length(filtered.hv), 0) = 0 then null
        when coalesce(jsonb_array_length(filtered.hv), 0) = 0 then
          o.quote_bulk_counts - 'card_hv'
        else
          jsonb_set(o.quote_bulk_counts, '{card_hv}', filtered.hv)
      end
      from (
        select coalesce(
          (
            select jsonb_agg(elem)
            from jsonb_array_elements(o.quote_bulk_counts -> 'card_hv') elem
            where nullif(trim(coalesce(elem ->> 'card_id', '')), '') is not null
              and elem ->> 'card_id' = any (
                select kid::text from unnest(v_kept_card_ids) kid
              )
          ),
          '[]'::jsonb
        ) as hv
      ) filtered
    )
  end
  where o.id = p_order_id;

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

-- One-time cleanup for orphans already left by earlier customer card deletes.
-- Only pending orders: customer edit is pending-only, and completed quote
-- history should not be rewritten if name/set ever drifted.
delete from public.order_quote_items qi
using public.orders o
where qi.order_id = o.id
  and o.status = 'pending'
  and not exists (
    select 1
    from public.cards c
    where c.order_id = qi.order_id
      and lower(trim(c.card_name)) = lower(trim(qi.card_name))
      and lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
  );

update public.orders o
set quote_bulk_counts = cleaned.payload
from (
  select
    o2.id,
    case
      when o2.quote_bulk_counts is null then null
      when jsonb_typeof(o2.quote_bulk_counts -> 'card_hv') is distinct from 'array' then o2.quote_bulk_counts
      else (
        select case
          when jsonb_array_length(coalesce(o2.quote_bulk_counts -> 'adjustments', '[]'::jsonb)) = 0
               and coalesce(jsonb_array_length(filtered.hv), 0) = 0 then null
          when coalesce(jsonb_array_length(filtered.hv), 0) = 0 then
            o2.quote_bulk_counts - 'card_hv'
          else
            jsonb_set(o2.quote_bulk_counts, '{card_hv}', filtered.hv)
        end
        from (
          select coalesce(
            (
              select jsonb_agg(elem)
              from jsonb_array_elements(o2.quote_bulk_counts -> 'card_hv') elem
              where nullif(trim(coalesce(elem ->> 'card_id', '')), '') is not null
                and exists (
                  select 1
                  from public.cards c
                  where c.order_id = o2.id
                    and c.id::text = elem ->> 'card_id'
                )
            ),
            '[]'::jsonb
          ) as hv
        ) filtered
      )
    end as payload
  from public.orders o2
  where o2.status = 'pending'
    and jsonb_typeof(o2.quote_bulk_counts -> 'card_hv') = 'array'
) cleaned
where o.id = cleaned.id
  and o.quote_bulk_counts is distinct from cleaned.payload;

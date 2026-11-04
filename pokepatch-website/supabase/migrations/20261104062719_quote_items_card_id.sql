-- Link order_quote_items to cards by id so duplicate title/set cards keep
-- their own restoration services. Name/set remain denormalized display fields.

ALTER TABLE public.order_quote_items
  ADD COLUMN IF NOT EXISTS card_id uuid;

-- Backfill: attach each quote line to the first matching card on the order
-- (same first-match behavior the admin UI used before this column existed).
UPDATE public.order_quote_items qi
SET card_id = (
  SELECT c.id
  FROM public.cards c
  WHERE c.order_id = qi.order_id
    AND lower(trim(c.card_name)) = lower(trim(qi.card_name))
    AND lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
  ORDER BY c.sort_order, c.id
  LIMIT 1
)
WHERE qi.card_id IS NULL;

ALTER TABLE public.order_quote_items
  DROP CONSTRAINT IF EXISTS order_quote_items_card_id_fkey;

ALTER TABLE public.order_quote_items
  ADD CONSTRAINT order_quote_items_card_id_fkey
  FOREIGN KEY (card_id) REFERENCES public.cards(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS order_quote_items_card_id_idx
  ON public.order_quote_items (card_id);

-- Prefer card_id so duplicate title/set cards do not share one quote.
CREATE OR REPLACE FUNCTION public.order_all_cards_have_quotes(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.cards c WHERE c.order_id = p_order_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.cards c
      WHERE c.order_id = p_order_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.order_quote_items qi
          WHERE qi.order_id = p_order_id
            AND qi.card_id = c.id
            AND trim(coalesce(qi.service_key, '')) <> ''
            AND trim(coalesce(qi.service_label, '')) <> ''
        )
    );
$$;

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
  v_quote_card_id uuid;
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

        v_quote_card_id := null;
        if v_quote_item ? 'card_id' and nullif(trim(coalesce(v_quote_item ->> 'card_id', '')), '') is not null then
          begin
            v_quote_card_id := (v_quote_item ->> 'card_id')::uuid;
          exception
            when others then
              raise exception 'quote item card_id must be a valid uuid';
          end;
          if not exists (
            select 1 from public.cards c
            where c.id = v_quote_card_id and c.order_id = p_order_id
          ) then
            -- Card may be created later in this transaction (deferred FK).
            -- Still reject ids that already belong to a different order.
            if exists (select 1 from public.cards c where c.id = v_quote_card_id) then
              raise exception 'quote item card_id not on order';
            end if;
          end if;
        end if;

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
          card_id,
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
          v_quote_card_id,
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
                'warping',
                'whitening'
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
              'warping',
              'whitening'
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
          sort_order
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
          v_card_sort
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


  -- Auto-advance from cards unless order status was edited this save:
  -- all completed → ready; else any in_progress → in_progress.
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
      elsif exists (
        select 1
        from public.cards c
        where c.order_id = p_order_id
          and c.status = 'in_progress'
      ) and v_status is distinct from 'in_progress' then
        update public.orders
        set
          status = 'in_progress',
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

CREATE OR REPLACE FUNCTION public._create_order_partition(p_order_id uuid, p_user_id uuid, p_first_name text, p_last_name text, p_customer_name text, p_customer_email text, p_delivery_method text, p_heard_about_source text, p_preferred_type text, p_preferred_value text, p_is_priority boolean, p_contacts jsonb, p_cards jsonb)
 RETURNS orders
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
            v_base_amount := 20;
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
          card_id,
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
          v_card_id,
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
GRANT EXECUTE ON FUNCTION public._create_order_partition(
  uuid, uuid, text, text, text, text, text, text, text, text, boolean, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.update_my_order(p_order_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_before jsonb;
  v_delivery_method text;
  v_preferred_type text;
  v_preferred_value text;
  v_card_is_priority boolean;
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
  v_split jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload is required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or access denied';
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'order can only be edited while pending';
  END IF;

  v_before := public.get_my_order(p_order_id);

  v_delivery_method := coalesce(
    p_payload ->> 'delivery_method',
    v_order.delivery_method
  );
  IF v_delivery_method NOT IN ('local_dropoff', 'shipping') THEN
    RAISE EXCEPTION 'delivery_method must be local_dropoff or shipping';
  END IF;

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  IF jsonb_typeof(v_contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts must be an array';
  END IF;
  IF jsonb_array_length(v_contacts) < 1 THEN
    RAISE EXCEPTION 'at least one additional contact is required';
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

  v_preferred_type := coalesce(
    nullif(trim(coalesce(p_payload ->> 'preferred_contact_type', '')), ''),
    coalesce(v_order.preferred_contact_type, 'email')
  );
  IF v_preferred_type NOT IN ('email', 'phone', 'discord', 'instagram') THEN
    RAISE EXCEPTION 'invalid preferred_contact_type';
  END IF;

  IF v_preferred_type = 'email' THEN
    v_preferred_value := v_order.customer_email;
  ELSE
    v_preferred_value := trim(coalesce(p_payload ->> 'preferred_contact_value', ''));
    IF v_preferred_value = '' THEN
      SELECT trim(c ->> 'value') INTO v_preferred_value
      FROM jsonb_array_elements(v_contacts) c
      WHERE c ->> 'contact_type' = v_preferred_type
        AND trim(coalesce(c ->> 'value', '')) <> ''
      LIMIT 1;
    END IF;
    IF coalesce(v_preferred_value, '') = '' THEN
      RAISE EXCEPTION 'preferred_contact_value is required';
    END IF;
  END IF;

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  IF jsonb_typeof(v_cards) <> 'array' THEN
    RAISE EXCEPTION 'cards must be an array';
  END IF;

  v_card_count := jsonb_array_length(v_cards);
  IF v_card_count < 1 THEN
    RAISE EXCEPTION 'at least one card is required';
  END IF;
  IF v_card_count > 25 THEN
    RAISE EXCEPTION 'at most 25 cards allowed';
  END IF;

  -- Validate all cards before mutating.
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
    IF v_image_count > 4 THEN
      RAISE EXCEPTION 'each card allows at most 4 customer images';
    END IF;

    v_path_prefix := 'order-' || p_order_id::text || '/card-' || v_card_id::text || '/';
    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      v_storage_path := trim(coalesce(v_image ->> 'storage_path', ''));
      IF v_storage_path = '' THEN
        RAISE EXCEPTION 'image storage_path is required';
      END IF;
      IF position(v_path_prefix IN v_storage_path) <> 1 THEN
        RAISE EXCEPTION 'image storage_path must belong to this order card';
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
  END LOOP;

  -- Order-level fields (never touch quote columns; do not write order is_priority).
  UPDATE public.orders
  SET
    delivery_method = v_delivery_method,
    preferred_contact_type = v_preferred_type,
    preferred_contact_value = v_preferred_value
  WHERE id = p_order_id;

  -- Replace contacts.
  DELETE FROM public.contacts WHERE order_id = p_order_id;
  FOR v_contact IN SELECT * FROM jsonb_array_elements(v_contacts)
  LOOP
    INSERT INTO public.contacts (order_id, contact_type, value)
    VALUES (
      p_order_id,
      v_contact ->> 'contact_type',
      trim(v_contact ->> 'value')
    );
  END LOOP;

  -- Sync cards (including per-card is_priority).
  v_sort_order := 0;
  FOR v_card IN SELECT * FROM jsonb_array_elements(v_cards)
  LOOP
    v_card_id := (v_card ->> 'id')::uuid;
    v_card_name := trim(v_card ->> 'card_name');
    v_set_name := nullif(trim(coalesce(v_card ->> 'set_name', '')), '');
    v_description := nullif(trim(coalesce(v_card ->> 'description', '')), '');
    v_card_is_priority := coalesce((v_card ->> 'is_priority')::boolean, false);

    v_damage_tags := '{}';
    v_seen_damage := '{}';
    FOR v_damage_tag IN
      SELECT trim(value)
      FROM jsonb_array_elements_text(coalesce(v_card -> 'damage_tags', '[]'::jsonb))
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

    SELECT * INTO v_existing_card
    FROM public.cards
    WHERE id = v_card_id AND order_id = p_order_id;

    IF FOUND THEN
      UPDATE public.cards
      SET
        card_name = v_card_name,
        set_name = v_set_name,
        description = v_description,
        damage_tags = v_damage_tags,
        sort_order = v_sort_order,
        is_priority = v_card_is_priority
      WHERE id = v_card_id;
    ELSE
      INSERT INTO public.cards (
        id, order_id, card_name, set_name, description, damage_tags, sort_order, is_priority
      )
      VALUES (
        v_card_id,
        p_order_id,
        v_card_name,
        v_set_name,
        v_description,
        v_damage_tags,
        v_sort_order,
        v_card_is_priority
      );
    END IF;

    v_kept_card_ids := array_append(v_kept_card_ids, v_card_id);

    -- Sync customer images only.
    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    v_kept_image_ids := '{}';
    v_customer_image_count := 0;

    FOR v_image IN SELECT * FROM jsonb_array_elements(v_images)
    LOOP
      v_storage_path := trim(v_image ->> 'storage_path');
      v_image_id := null;
      IF v_image ? 'id' AND nullif(trim(coalesce(v_image ->> 'id', '')), '') IS NOT NULL THEN
        BEGIN
          v_image_id := (v_image ->> 'id')::bigint;
        EXCEPTION
          WHEN others THEN
            v_image_id := null;
        END;
      END IF;

      IF v_image_id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1
          FROM public.card_images ci
          WHERE ci.id = v_image_id
            AND ci.card_id = v_card_id
            AND ci.image_type = 'customer'
        ) THEN
          UPDATE public.card_images
          SET storage_path = v_storage_path
          WHERE id = v_image_id;
          v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
          v_customer_image_count := v_customer_image_count + 1;
          CONTINUE;
        END IF;
      END IF;

      SELECT ci.id INTO v_image_id
      FROM public.card_images ci
      WHERE ci.card_id = v_card_id
        AND ci.image_type = 'customer'
        AND ci.storage_path = v_storage_path
      LIMIT 1;

      IF v_image_id IS NOT NULL THEN
        v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
        v_customer_image_count := v_customer_image_count + 1;
      ELSE
        INSERT INTO public.card_images (card_id, image_type, storage_path)
        VALUES (v_card_id, 'customer', v_storage_path)
        RETURNING id INTO v_image_id;
        v_kept_image_ids := array_append(v_kept_image_ids, v_image_id);
        v_customer_image_count := v_customer_image_count + 1;
      END IF;
    END LOOP;

    IF v_customer_image_count < 1 THEN
      RAISE EXCEPTION 'each card requires at least one customer image';
    END IF;

    DELETE FROM public.card_images ci
    WHERE ci.card_id = v_card_id
      AND ci.image_type = 'customer'
      AND NOT (ci.id = ANY (v_kept_image_ids));

    v_sort_order := v_sort_order + 1;
  END LOOP;

  DELETE FROM public.cards
  WHERE order_id = p_order_id
    AND NOT (id = ANY (v_kept_card_ids));

  -- card_id rows cascade on card delete; clear legacy name/set orphans only.
  DELETE FROM public.order_quote_items qi
  WHERE qi.order_id = p_order_id
    AND qi.card_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.cards c
      WHERE c.order_id = p_order_id
        AND lower(trim(c.card_name)) = lower(trim(qi.card_name))
        AND lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
    );

  UPDATE public.orders o
  SET quote_bulk_counts = CASE
    WHEN o.quote_bulk_counts IS NULL THEN null
    WHEN jsonb_typeof(o.quote_bulk_counts -> 'card_hv') IS DISTINCT FROM 'array' THEN o.quote_bulk_counts
    ELSE (
      SELECT CASE
        WHEN jsonb_array_length(coalesce(o.quote_bulk_counts -> 'adjustments', '[]'::jsonb)) = 0
             AND coalesce(jsonb_array_length(filtered.hv), 0) = 0 THEN null
        WHEN coalesce(jsonb_array_length(filtered.hv), 0) = 0 THEN
          o.quote_bulk_counts - 'card_hv'
        ELSE
          jsonb_set(o.quote_bulk_counts, '{card_hv}', filtered.hv)
      END
      FROM (
        SELECT coalesce(
          (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(o.quote_bulk_counts -> 'card_hv') elem
            WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
              AND elem ->> 'card_id' = ANY (
                SELECT kid::text FROM unnest(v_kept_card_ids) kid
              )
          ),
          '[]'::jsonb
        ) AS hv
      ) filtered
    )
  END
  WHERE o.id = p_order_id;

  -- Auto-split if cards are now mixed priority; reconcile fee otherwise.
  v_split := public.split_mixed_priority_order(p_order_id);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  v_after := public.get_my_order(p_order_id);

  -- Build a customer-facing changelog for admin visibility.
  IF coalesce(v_before ->> 'delivery_method', '') IS DISTINCT FROM v_order.delivery_method THEN
    v_order_changes := v_order_changes || jsonb_build_array(
      format(
        'Delivery: %s → %s',
        CASE coalesce(v_before ->> 'delivery_method', '')
          WHEN 'local_dropoff' THEN 'Local Drop-Off'
          WHEN 'shipping' THEN 'Shipping'
          ELSE coalesce(v_before ->> 'delivery_method', '—')
        END,
        CASE v_order.delivery_method
          WHEN 'local_dropoff' THEN 'Local Drop-Off'
          WHEN 'shipping' THEN 'Shipping'
          ELSE v_order.delivery_method
        END
      )
    );
  END IF;

  IF coalesce((v_before ->> 'is_priority')::boolean, false) IS DISTINCT FROM v_order.is_priority THEN
    v_order_changes := v_order_changes || jsonb_build_array(
      CASE
        WHEN v_order.is_priority THEN 'Added: Priority service'
        ELSE 'Removed: Priority service'
      END
    );
  END IF;

  IF coalesce((v_split ->> 'split')::boolean, false) THEN
    v_order_changes := v_order_changes || jsonb_build_array(
      format(
        'Split into priority order #%s',
        coalesce(v_split ->> 'new_display_id', v_split ->> 'new_order_id')
      )
    );
  END IF;

  SELECT string_agg(contact_type || ':' || value, ',' ORDER BY contact_type, value)
    INTO v_before_contacts
  FROM jsonb_to_recordset(coalesce(v_before -> 'contacts', '[]'::jsonb))
    AS x(contact_type text, value text);

  SELECT string_agg(contact_type || ':' || value, ',' ORDER BY contact_type, value)
    INTO v_after_contacts
  FROM public.contacts
  WHERE order_id = p_order_id;

  IF coalesce(v_before_contacts, '') IS DISTINCT FROM coalesce(v_after_contacts, '') THEN
    v_order_changes := v_order_changes || jsonb_build_array('Updated contacts');
  END IF;

  IF coalesce(v_before ->> 'preferred_contact_type', '') IS DISTINCT FROM coalesce(v_order.preferred_contact_type, '')
     OR coalesce(v_before ->> 'preferred_contact_value', '') IS DISTINCT FROM coalesce(v_order.preferred_contact_value, '') THEN
    v_order_changes := v_order_changes || jsonb_build_array('Updated preferred contact');
  END IF;

  FOR v_before_card IN
    SELECT value
    FROM jsonb_array_elements(coalesce(v_before -> 'cards', '[]'::jsonb))
  LOOP
    -- Missing from after = deleted or moved off this order by priority split.
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(v_after -> 'cards', '[]'::jsonb)) a
      WHERE a ->> 'id' = v_before_card ->> 'id'
    ) THEN
      v_label := trim(coalesce(v_before_card ->> 'card_name', 'Card'));
      IF nullif(trim(coalesce(v_before_card ->> 'set_name', '')), '') IS NOT NULL THEN
        v_label := v_label || ' (' || trim(v_before_card ->> 'set_name') || ')';
      END IF;
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_before_card ->> 'id',
          'label', v_label,
          'status', 'removed',
          'sortIndex', 1000,
          'changes', '[]'::jsonb
        )
      );
    END IF;
  END LOOP;

  FOR v_after_card IN
    SELECT value
    FROM jsonb_array_elements(coalesce(v_after -> 'cards', '[]'::jsonb))
  LOOP
    v_before_card := null;
    SELECT value INTO v_before_card
    FROM jsonb_array_elements(coalesce(v_before -> 'cards', '[]'::jsonb)) value
    WHERE value ->> 'id' = v_after_card ->> 'id'
    LIMIT 1;

    v_label := trim(coalesce(v_after_card ->> 'card_name', 'Card'));
    IF nullif(trim(coalesce(v_after_card ->> 'set_name', '')), '') IS NOT NULL THEN
      v_label := v_label || ' (' || trim(v_after_card ->> 'set_name') || ')';
    END IF;

    IF v_before_card IS NULL THEN
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_after_card ->> 'id',
          'label', v_label,
          'status', 'added',
          'sortIndex', 0,
          'changes', '[]'::jsonb
        )
      );
      CONTINUE;
    END IF;

    v_card_changes := '{}';
    IF coalesce(v_before_card ->> 'card_name', '') IS DISTINCT FROM coalesce(v_after_card ->> 'card_name', '') THEN
      v_card_changes := array_append(
        v_card_changes,
        format('Name: %s → %s', coalesce(v_before_card ->> 'card_name', '—'), coalesce(v_after_card ->> 'card_name', '—'))
      );
    END IF;
    IF coalesce(v_before_card ->> 'set_name', '') IS DISTINCT FROM coalesce(v_after_card ->> 'set_name', '') THEN
      v_card_changes := array_append(
        v_card_changes,
        format('Set: %s → %s', coalesce(nullif(v_before_card ->> 'set_name', ''), '—'), coalesce(nullif(v_after_card ->> 'set_name', ''), '—'))
      );
    END IF;
    IF coalesce(v_before_card ->> 'description', '') IS DISTINCT FROM coalesce(v_after_card ->> 'description', '') THEN
      v_card_changes := array_append(v_card_changes, 'Updated description');
    END IF;
    IF coalesce(v_before_card -> 'damage_tags', '[]'::jsonb) IS DISTINCT FROM coalesce(v_after_card -> 'damage_tags', '[]'::jsonb) THEN
      v_card_changes := array_append(v_card_changes, 'Updated damage tags');
    END IF;
    IF coalesce((v_before_card ->> 'is_priority')::boolean, false)
         IS DISTINCT FROM coalesce((v_after_card ->> 'is_priority')::boolean, false) THEN
      v_card_changes := array_append(
        v_card_changes,
        CASE
          WHEN coalesce((v_after_card ->> 'is_priority')::boolean, false) THEN 'Added: Priority service'
          ELSE 'Removed: Priority service'
        END
      );
    END IF;
    IF (
      SELECT coalesce(jsonb_agg(i ->> 'storage_path' ORDER BY i ->> 'storage_path'), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_before_card -> 'images', '[]'::jsonb)) i
      WHERE coalesce(i ->> 'image_type', 'customer') = 'customer'
    ) IS DISTINCT FROM (
      SELECT coalesce(jsonb_agg(i ->> 'storage_path' ORDER BY i ->> 'storage_path'), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v_after_card -> 'images', '[]'::jsonb)) i
      WHERE coalesce(i ->> 'image_type', 'customer') = 'customer'
    ) THEN
      v_card_changes := array_append(v_card_changes, 'Updated photos');
    END IF;

    IF coalesce(array_length(v_card_changes, 1), 0) > 0 THEN
      v_card_groups := v_card_groups || jsonb_build_array(
        jsonb_build_object(
          'cardId', v_after_card ->> 'id',
          'label', v_label,
          'status', 'modified',
          'sortIndex', 100,
          'changes', to_jsonb(v_card_changes)
        )
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_order_changes) > 0 OR jsonb_array_length(v_card_groups) > 0 THEN
    v_changelog := jsonb_build_object(
      'cardGroups', v_card_groups,
      'orderChanges', v_order_changes,
      'quoteSummary', null
    );

    PERFORM public._insert_customer_order_message(
      v_order,
      'Customer updated order #' || v_order.display_id::text,
      'The customer updated this order while it was still pending.',
      v_changelog
    );
  END IF;

  RETURN v_after || jsonb_build_object(
    'split', coalesce((v_split ->> 'split')::boolean, false),
    'split_result', v_split
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.update_my_order(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_my_order(uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.update_my_order(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_order(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_contacts jsonb;
  v_cards jsonb;
  v_quote_items jsonb;
  v_queue_position integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found or access denied';
  END IF;

  IF v_order.status = 'new' THEN
    SELECT q.queue_position INTO v_queue_position
    FROM (
      SELECT
        o2.id AS order_id,
        row_number() OVER (
          ORDER BY
            o2.is_priority DESC,
            o2.created_at ASC NULLS LAST,
            o2.id ASC
        )::integer AS queue_position
      FROM public.orders o2
      WHERE o2.status = 'new'
    ) q
    WHERE q.order_id = v_order.id;
  ELSE
    v_queue_position := null;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'contact_type', c.contact_type,
      'value', c.value
    )
    ORDER BY c.id
  ) INTO v_contacts
  FROM public.contacts c
  WHERE c.order_id = v_order.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', card.id,
      'card_name', card.card_name,
      'set_name', card.set_name,
      'description', card.description,
      'damage_tags', coalesce(card.damage_tags, '{}'::text[]),
      'admin_note', card.admin_note,
      'status', card.status,
      'is_priority', card.is_priority,
      'images', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ci.id,
            'image_type', ci.image_type,
            'storage_path', ci.storage_path
          )
          ORDER BY ci.id
        )
        FROM public.card_images ci
        WHERE ci.card_id = card.id
      )
    )
    ORDER BY card.sort_order, card.id
  ) INTO v_cards
  FROM public.cards card
  WHERE card.order_id = v_order.id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', qi.id,
      'sort_order', qi.sort_order,
      'card_id', qi.card_id,
      'card_name', qi.card_name,
      'set_name', qi.set_name,
      'service_key', qi.service_key,
      'service_label', qi.service_label,
      'quote_base_amount', qi.quote_base_amount,
      'high_value_surcharge', qi.high_value_surcharge
    )
    ORDER BY qi.sort_order, qi.id
  ) INTO v_quote_items
  FROM public.order_quote_items qi
  WHERE qi.order_id = v_order.id;

  RETURN jsonb_build_object(
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
    'queue_position', v_queue_position,
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.get_my_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_order(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_order(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.split_mixed_priority_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source public.orders%rowtype;
  v_new public.orders%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_has_priority boolean;
  v_has_non_priority boolean;
  v_reconcile_priority boolean;
  v_moved_ids uuid[];
  v_contact public.contacts%rowtype;
  v_bulk jsonb;
  v_adjustments jsonb;
  v_without_priority jsonb;
  v_card_hv jsonb;
  v_stay_hv jsonb;
  v_move_hv jsonb;
  v_stay_bulk jsonb;
  v_move_bulk jsonb;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order id is required';
  END IF;

  SELECT * INTO v_source
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.cards c
      WHERE c.order_id = p_order_id AND c.is_priority = true
    ),
    EXISTS (
      SELECT 1 FROM public.cards c
      WHERE c.order_id = p_order_id AND c.is_priority = false
    )
  INTO v_has_priority, v_has_non_priority;

  IF NOT (v_has_priority AND v_has_non_priority) THEN
    -- Homogeneous (or empty — empty should not happen): reconcile order flag.
    SELECT EXISTS (
      SELECT 1
      FROM public.cards c
      WHERE c.order_id = p_order_id
        AND c.is_priority = true
        AND c.status IS DISTINCT FROM 'canceled'
    )
    INTO v_reconcile_priority;

    UPDATE public.orders
    SET is_priority = v_reconcile_priority
    WHERE id = p_order_id
      AND is_priority IS DISTINCT FROM v_reconcile_priority;

    PERFORM public.sync_order_priority_quote_adjustment(p_order_id);

    RETURN jsonb_build_object(
      'split', false,
      'id', p_order_id
    );
  END IF;

  -- Mixed: create sibling priority order and move priority cards onto it.
  INSERT INTO public.orders (
    id,
    user_id,
    first_name,
    last_name,
    customer_name,
    customer_email,
    delivery_method,
    general_notes,
    heard_about_source,
    preferred_contact_type,
    preferred_contact_value,
    status,
    pending_kind,
    photos_drive_url,
    quote_override_label,
    quote_override_amount,
    after_completion_amounts,
    restoration_costs,
    is_priority,
    quote_bulk_counts
  )
  SELECT
    v_new_id,
    s.user_id,
    s.first_name,
    s.last_name,
    s.customer_name,
    s.customer_email,
    s.delivery_method,
    s.general_notes,
    s.heard_about_source,
    s.preferred_contact_type,
    s.preferred_contact_value,
    s.status,
    s.pending_kind,
    s.photos_drive_url,
    s.quote_override_label,
    s.quote_override_amount,
    s.after_completion_amounts,
    s.restoration_costs,
    true,
    null
  FROM public.orders s
  WHERE s.id = p_order_id
  RETURNING * INTO v_new;

  INSERT INTO public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes
  )
  VALUES (
    v_new.id,
    v_new.display_id,
    v_new.created_at,
    v_new.first_name,
    v_new.last_name,
    v_new.customer_name,
    v_new.delivery_method,
    v_new.general_notes
  );

  -- Duplicate live contacts onto the new order (skip contacts_original).
  FOR v_contact IN
    SELECT * FROM public.contacts WHERE order_id = p_order_id
  LOOP
    INSERT INTO public.contacts (order_id, contact_type, value)
    VALUES (v_new_id, v_contact.contact_type, v_contact.value);
  END LOOP;

  SELECT coalesce(array_agg(c.id), '{}'::uuid[])
  INTO v_moved_ids
  FROM public.cards c
  WHERE c.order_id = p_order_id
    AND c.is_priority = true;

  IF coalesce(array_length(v_moved_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'mixed priority split found no priority cards';
  END IF;

  -- Remainder must keep at least one card (mix implies non-priority exist).
  IF NOT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.order_id = p_order_id
      AND c.is_priority = false
  ) THEN
    RAISE EXCEPTION 'mixed priority split would leave original order empty';
  END IF;

  UPDATE public.cards
  SET order_id = v_new_id
  WHERE id = ANY (v_moved_ids);

  UPDATE public.cards_original
  SET order_id = v_new_id
  WHERE id = ANY (v_moved_ids);

  -- Move quote lines for moved cards (prefer card_id; name/set for legacy nulls).
  UPDATE public.order_quote_items qi
  SET order_id = v_new_id
  WHERE qi.order_id = p_order_id
    AND (
      qi.card_id = ANY (v_moved_ids)
      OR (
        qi.card_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.cards c
          WHERE c.id = ANY (v_moved_ids)
            AND lower(trim(c.card_name)) = lower(trim(qi.card_name))
            AND lower(trim(coalesce(c.set_name, ''))) = lower(trim(coalesce(qi.set_name, '')))
        )
      )
    );

  -- Partition quote_bulk_counts.card_hv; strip Priority service (rebuild via sync).
  v_bulk := v_source.quote_bulk_counts;

  IF v_bulk IS NULL OR jsonb_typeof(v_bulk) <> 'object' THEN
    v_adjustments := '[]'::jsonb;
    v_card_hv := '[]'::jsonb;
  ELSE
    v_adjustments := coalesce(v_bulk -> 'adjustments', '[]'::jsonb);
    IF jsonb_typeof(v_adjustments) <> 'array' THEN
      v_adjustments := '[]'::jsonb;
    END IF;
    IF jsonb_typeof(v_bulk -> 'card_hv') = 'array' THEN
      v_card_hv := v_bulk -> 'card_hv';
    ELSE
      v_card_hv := '[]'::jsonb;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_without_priority
  FROM jsonb_array_elements(v_adjustments) elem
  WHERE lower(trim(coalesce(elem ->> 'description', '')))
        IS DISTINCT FROM 'priority service';

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_stay_hv
  FROM jsonb_array_elements(v_card_hv) elem
  WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
    AND NOT (elem ->> 'card_id' = ANY (SELECT mid::text FROM unnest(v_moved_ids) mid));

  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  INTO v_move_hv
  FROM jsonb_array_elements(v_card_hv) elem
  WHERE nullif(trim(coalesce(elem ->> 'card_id', '')), '') IS NOT NULL
    AND elem ->> 'card_id' = ANY (SELECT mid::text FROM unnest(v_moved_ids) mid);

  -- Other adjustments stay on the original; new order gets moved HV only.
  IF jsonb_array_length(v_without_priority) = 0
     AND jsonb_array_length(v_stay_hv) = 0 THEN
    v_stay_bulk := null;
  ELSE
    v_stay_bulk := jsonb_build_object('version', 2);
    IF jsonb_array_length(v_without_priority) > 0 THEN
      v_stay_bulk := jsonb_set(v_stay_bulk, '{adjustments}', v_without_priority, true);
    END IF;
    IF jsonb_array_length(v_stay_hv) > 0 THEN
      v_stay_bulk := jsonb_set(v_stay_bulk, '{card_hv}', v_stay_hv, true);
    END IF;
  END IF;

  IF jsonb_array_length(v_move_hv) = 0 THEN
    v_move_bulk := null;
  ELSE
    v_move_bulk := jsonb_build_object(
      'version', 2,
      'card_hv', v_move_hv
    );
  END IF;

  UPDATE public.orders
  SET
    is_priority = false,
    quote_bulk_counts = v_stay_bulk
  WHERE id = p_order_id;

  UPDATE public.orders
  SET
    is_priority = true,
    quote_bulk_counts = v_move_bulk
  WHERE id = v_new_id;

  PERFORM public.sync_order_priority_quote_adjustment(p_order_id);
  PERFORM public.sync_order_priority_quote_adjustment(v_new_id);

  SELECT * INTO v_source FROM public.orders WHERE id = p_order_id;
  SELECT * INTO v_new FROM public.orders WHERE id = v_new_id;

  RETURN jsonb_build_object(
    'split', true,
    'id', v_source.id,
    'display_id', v_source.display_id,
    'new_order_id', v_new.id,
    'new_display_id', v_new.display_id
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.split_mixed_priority_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.split_mixed_priority_order(uuid) TO service_role;

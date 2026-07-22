-- Add on_hold order status: constraint, RPC allowlists, home queue merge.

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'new'::text,
        'on_hold'::text,
        'in_progress'::text,
        'completed'::text,
        'canceled'::text
      ]
    )
  );


-- update_order: allow on_hold
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
  v_market_value numeric(10, 2);
  v_card_status text;
  v_prev_card_status text;
  v_card_status_changed boolean := false;
  v_status text;
  v_prev_status text;
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
      if v_status not in ('new', 'on_hold', 'in_progress', 'completed', 'canceled') then
        raise exception 'invalid status';
      end if;

      update public.orders
      set
        status = v_status,
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
          market_value_raw_nm,
          status
        )
        values (
          v_card_id,
          p_order_id,
          v_card_name,
          v_set_name,
          v_description,
          v_market_value,
          v_card_status
        );
      end if;

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
  end if;

  if v_card_status_changed then
    update public.orders
    set updates_available_at = now()
    where id = p_order_id;
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
    'completed_at', v_order.completed_at,
    'quote_bulk_counts', v_order.quote_bulk_counts,
    'quote_override_label', v_order.quote_override_label,
    'quote_override_amount', v_order.quote_override_amount
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.update_order(uuid, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_order(uuid, jsonb, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.reorder_status_orders(
  p_status text,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_index integer := 0;
  v_status text;
BEGIN
  IF p_ordered_ids IS NULL THEN
    RAISE EXCEPTION 'ordered_ids is required';
  END IF;

  v_status := CASE
    WHEN p_status IN ('new', 'todo') THEN 'new'
    WHEN p_status = 'on_hold' THEN 'on_hold'
    WHEN p_status IN ('in_progress', 'completed', 'canceled', 'cancelled') THEN
      CASE WHEN p_status = 'cancelled' THEN 'canceled' ELSE p_status END
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  FOREACH v_id IN ARRAY p_ordered_ids
  LOOP
    UPDATE public.orders
    SET queue_priority = v_index
    WHERE id = v_id
      AND status = v_status;
    v_index := v_index + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_status_orders(text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_status_orders(text, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.move_order_in_status(
  p_order_id uuid,
  p_status text,
  p_queue_index integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_old_status text;
  v_ids uuid[];
  v_filtered uuid[];
  v_insert_at integer;
BEGIN
  v_status := CASE
    WHEN p_status IN ('new', 'todo') THEN 'new'
    WHEN p_status = 'on_hold' THEN 'on_hold'
    WHEN p_status IN ('in_progress', 'completed', 'canceled', 'cancelled') THEN
      CASE WHEN p_status = 'cancelled' THEN 'canceled' ELSE p_status END
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  SELECT status INTO v_old_status
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF v_old_status IS DISTINCT FROM v_status THEN
    UPDATE public.orders
    SET
      status = v_status,
      status_changed_at = now(),
      completed_at = CASE
        WHEN v_status IN ('completed', 'canceled') THEN COALESCE(completed_at, now())
        ELSE NULL
      END
    WHERE id = p_order_id;
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY queue_priority ASC NULLS LAST, created_at ASC NULLS LAST, id ASC), '{}')
    INTO v_ids
  FROM public.orders
  WHERE status = v_status;

  SELECT COALESCE(array_agg(id), '{}')
    INTO v_filtered
  FROM unnest(v_ids) AS id
  WHERE id IS DISTINCT FROM p_order_id;

  IF p_queue_index IS NULL OR p_queue_index >= coalesce(cardinality(v_filtered), 0) THEN
    v_ids := v_filtered || ARRAY[p_order_id];
  ELSIF p_queue_index <= 0 THEN
    v_ids := ARRAY[p_order_id] || v_filtered;
  ELSE
    v_insert_at := p_queue_index;
    v_ids :=
      v_filtered[1:v_insert_at]
      || ARRAY[p_order_id]
      || v_filtered[v_insert_at + 1 : cardinality(v_filtered)];
  END IF;

  PERFORM public.reorder_status_orders(v_status, v_ids);

  IF v_old_status IS DISTINCT FROM v_status THEN
    SELECT COALESCE(array_agg(id ORDER BY queue_priority ASC NULLS LAST, created_at ASC NULLS LAST, id ASC), '{}')
      INTO v_ids
    FROM public.orders
    WHERE status = v_old_status;
    PERFORM public.reorder_status_orders(v_old_status, v_ids);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.move_order_in_status(uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.move_order_in_status(uuid, text, integer) TO service_role;

-- Home Live Queue "in queue": todo cards on new OR on_hold orders.
CREATE OR REPLACE FUNCTION public.get_queue_card_count()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'todo',
    (
      SELECT count(*)::integer
      FROM public.cards c
      INNER JOIN public.orders o ON o.id = c.order_id
      WHERE c.status = 'todo'
        AND o.status IN ('new', 'on_hold')
    ),
    'in_progress',
    (
      SELECT count(*)::integer
      FROM public.cards c
      WHERE c.status = 'in_progress'
    ),
    'completed',
    (
      SELECT count(*)::integer
      FROM public.cards c
      WHERE c.status = 'completed'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_queue_card_count() FROM public;
GRANT EXECUTE ON FUNCTION public.get_queue_card_count() TO anon;
GRANT EXECUTE ON FUNCTION public.get_queue_card_count() TO authenticated;

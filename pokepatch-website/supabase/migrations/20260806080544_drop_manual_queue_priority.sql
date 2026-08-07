-- Remove admin manual queue reorder (queue_priority). Paid is_priority controls queue order.

DROP TRIGGER IF EXISTS orders_set_queue_priority_bi ON public.orders;
DROP TRIGGER IF EXISTS orders_set_queue_priority_bu ON public.orders;

UPDATE public.orders
SET queue_priority = NULL
WHERE queue_priority IS NOT NULL;

CREATE OR REPLACE FUNCTION public.orders_set_queue_priority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.queue_priority := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_status_orders(
  p_status text,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Manual reorder removed; queue order is is_priority then created_at.
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_queue_orders(p_ordered_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.list_queue_orders();
END;
$$;

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
BEGIN
  v_status := CASE
    WHEN p_status IN ('new', 'todo') THEN 'new'
    WHEN p_status IN ('on_hold', 'pending', 'pending_quote', 'pending_dropoff') THEN 'pending'
    WHEN p_status IN ('ready', 'ready_for_customer') THEN 'ready'
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
      pending_kind = CASE
        WHEN v_status = 'pending' THEN COALESCE(pending_kind, 'quote')
        ELSE NULL
      END,
      status_changed_at = now(),
      completed_at = CASE
        WHEN v_status IN ('completed', 'canceled') THEN COALESCE(completed_at, now())
        ELSE NULL
      END,
      queue_priority = NULL
    WHERE id = p_order_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_queue_orders()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'display_id', o.display_id,
        'created_at', o.created_at,
        'customer_name', o.customer_name,
        'customer_email', o.customer_email,
        'status', o.status,
        'is_priority', o.is_priority,
        'active_card_count', (
          SELECT COUNT(*)::integer
          FROM public.cards c
          WHERE c.order_id = o.id
            AND c.status IN ('todo', 'in_progress')
        ),
        'card_count', (
          SELECT COUNT(*)::integer
          FROM public.cards c
          WHERE c.order_id = o.id
        )
      )
      ORDER BY o.is_priority DESC, o.created_at ASC NULLS LAST, o.id ASC
    ),
    '[]'::jsonb
  )
  FROM public.orders o
  WHERE o.status = 'new';
$$;

-- get_my_orders / get_my_order: queue_position from is_priority + created_at only.

CREATE OR REPLACE FUNCTION public.get_my_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_orders jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'display_id', o.display_id,
      'created_at', o.created_at,
      'customer_name', o.customer_name,
      'delivery_method', o.delivery_method,
      'status', o.status,
      'pending_kind', o.pending_kind,
      'is_priority', o.is_priority,
      'completed_at', o.completed_at,
      'status_changed_at', o.status_changed_at,
      'card_count', (
        select count(*)
        from public.cards c
        where c.order_id = o.id
      ),
      'queue_position', (
        case
          when o.status = 'new' then (
            select q.queue_position
            from (
              select
                o2.id as order_id,
                row_number() over (
                  order by
                    o2.is_priority desc,
                    o2.created_at asc nulls last,
                    o2.id asc
                )::integer as queue_position
              from public.orders o2
              where o2.status = 'new'
            ) q
            where q.order_id = o.id
          )
          else null
        end
      ),
      'has_unread_messages', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'has_new_updates', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'has_admin_photos', exists (
        select 1
        from public.customer_messages cm
        where cm.order_id = o.id
          and cm.read_at is null
          and cm.email_status = 'sent'
      ),
      'preview_paths', (
        select coalesce(jsonb_agg(t.storage_path order by t.rn), '[]'::jsonb)
        from (
          select ci.storage_path,
                 row_number() over (order by c.sort_order, c.id, ci.id) as rn
          from public.cards c
          join public.card_images ci on ci.card_id = c.id
          where c.order_id = o.id and ci.image_type = 'customer'
        ) t
        where t.rn <= 4
      ),
      'image_count', (
        select count(*)
        from public.cards c
        join public.card_images ci on ci.card_id = c.id
        where c.order_id = o.id and ci.image_type = 'customer'
      )
    )
    order by o.created_at desc
  ) into v_orders
  from public.orders o
  where o.user_id = v_user_id;

  return coalesce(v_orders, '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      'admin_note', card.admin_note,
      'market_value_raw_nm', card.market_value_raw_nm,
      'status', card.status,
      'queue_position', (
        SELECT q.queue_position
        FROM (
          SELECT
            c2.id AS card_id,
            ROW_NUMBER() OVER (
              ORDER BY
                o2.is_priority DESC,
                o2.created_at ASC NULLS LAST,
                c2.id ASC
            )::integer AS queue_position
          FROM public.cards c2
          INNER JOIN public.orders o2 ON o2.id = c2.order_id
          WHERE o2.status = 'new'
            AND c2.status IN ('todo', 'in_progress')
        ) q
        WHERE q.card_id = card.id
          AND v_order.status = 'new'
          AND card.status IN ('todo', 'in_progress')
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
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
end;
$$;

COMMENT ON COLUMN public.orders.queue_priority IS
  'Deprecated: manual admin reorder removed. NULL for all orders; queue uses is_priority then created_at.';

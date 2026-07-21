-- Customer queue is order-level among To do (status = new) only.
-- In-progress orders are out of the queue. Drop per-card queue_position.

-- Homepage / public count: cards on to-do orders only
CREATE OR REPLACE FUNCTION public.get_queue_card_count()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'count',
    (
      SELECT COUNT(*)::integer
      FROM public.cards c
      INNER JOIN public.orders o ON o.id = c.order_id
      WHERE o.status = 'new'
        AND c.status IN ('todo', 'in_progress')
    )
  );
$$;
REVOKE ALL ON FUNCTION public.get_queue_card_count() FROM public;
GRANT EXECUTE ON FUNCTION public.get_queue_card_count() TO anon;
GRANT EXECUTE ON FUNCTION public.get_queue_card_count() TO authenticated;
-- My Orders list: order-level queue_position among to-do orders
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
                    o2.queue_priority asc nulls last,
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
      'updates_available_at', o.updates_available_at,
      'has_new_updates', (
        o.updates_available_at is not null
        and (
          o.customer_updates_seen_at is null
          or o.updates_available_at > o.customer_updates_seen_at
        )
      ),
      -- Keep legacy key for older clients; same meaning as has_new_updates.
      'has_admin_photos', (
        o.updates_available_at is not null
        and (
          o.customer_updates_seen_at is null
          or o.updates_available_at > o.customer_updates_seen_at
        )
      ),
      'preview_paths', (
        select coalesce(jsonb_agg(t.storage_path order by t.rn), '[]'::jsonb)
        from (
          select ci.storage_path,
                 row_number() over (order by c.id, ci.id) as rn
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
REVOKE ALL ON FUNCTION public.get_my_orders() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_orders() TO authenticated;
-- Detail: remove per-card queue_position (order place comes from get_my_orders)
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
      'market_value_raw_nm', card.market_value_raw_nm,
      'status', card.status,
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
    order by card.id
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
    'status', v_order.status,
    'queue_position', (
      case
        when v_order.status = 'new' then (
          select q.queue_position
          from (
            select
              o2.id as order_id,
              row_number() over (
                order by
                  o2.queue_priority asc nulls last,
                  o2.created_at asc nulls last,
                  o2.id asc
              )::integer as queue_position
            from public.orders o2
            where o2.status = 'new'
          ) q
          where q.order_id = v_order.id
        )
        else null
      end
    ),
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
end;
$$;
REVOKE ALL ON FUNCTION public.get_my_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_order(uuid) TO authenticated;
-- Admin priority page: only to-do (new) orders are in the queue
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
        'queue_priority', o.queue_priority,
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
      ORDER BY o.queue_priority ASC NULLS LAST, o.created_at ASC NULLS LAST, o.id ASC
    ),
    '[]'::jsonb
  )
  FROM public.orders o
  WHERE o.status = 'new';
$$;
REVOKE ALL ON FUNCTION public.list_queue_orders() FROM public;
GRANT EXECUTE ON FUNCTION public.list_queue_orders() TO service_role;
CREATE OR REPLACE FUNCTION public.reorder_queue_orders(p_ordered_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_index integer := 0;
BEGIN
  IF p_ordered_ids IS NULL THEN
    RAISE EXCEPTION 'ordered_ids is required';
  END IF;

  FOREACH v_id IN ARRAY p_ordered_ids
  LOOP
    UPDATE public.orders
    SET queue_priority = v_index
    WHERE id = v_id
      AND status = 'new';
    v_index := v_index + 1;
  END LOOP;

  RETURN public.list_queue_orders();
END;
$$;
REVOKE ALL ON FUNCTION public.reorder_queue_orders(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_queue_orders(uuid[]) TO service_role;

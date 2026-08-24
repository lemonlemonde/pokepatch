-- Expose order-level queue_position on get_my_order (same as get_my_orders):
-- 1-based place among status=new (To do). Null once the order leaves the queue.

CREATE OR REPLACE FUNCTION public.get_my_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_contacts jsonb;
  v_cards jsonb;
  v_quote_items jsonb;
  v_queue_position integer;
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

  if v_order.status = 'new' then
    select q.queue_position into v_queue_position
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
    where q.order_id = v_order.id;
  else
    v_queue_position := null;
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
    'queue_position', v_queue_position,
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_my_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_order(uuid) TO authenticated;

-- Order-level queue priority for open orders (new / in_progress).
-- Lower queue_priority = higher priority. Cards within an order stay sequential by id.
--
-- Safety:
-- - Additive column + RPCs; no destructive DDL.
-- - New orders get max(queue_priority)+1 via BEFORE INSERT trigger (covers create_order).

-- 1) Column
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS queue_priority integer;
COMMENT ON COLUMN public.orders.queue_priority IS
  'Lower = higher priority in the global card queue. Only meaningful for open orders.';
-- 2) Backfill open orders by created_at (oldest first = higher priority)
WITH ranked AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) - 1)::integer AS rank
  FROM public.orders
  WHERE status IN ('new', 'in_progress')
)
UPDATE public.orders o
SET queue_priority = ranked.rank
FROM ranked
WHERE o.id = ranked.id;
-- Closed / other orders: leave null (they are not in the active queue list).

-- 3) Auto-assign queue_priority on insert when not provided
CREATE OR REPLACE FUNCTION public.orders_set_queue_priority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.queue_priority IS NULL THEN
    SELECT COALESCE(MAX(queue_priority), -1) + 1
      INTO NEW.queue_priority
    FROM public.orders;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_set_queue_priority_bi ON public.orders;
CREATE TRIGGER orders_set_queue_priority_bi
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_set_queue_priority();
-- 4) Public queue card count (todo + in_progress cards on open orders)
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
      WHERE o.status IN ('new', 'in_progress')
        AND c.status IN ('todo', 'in_progress')
    )
  );
$$;
REVOKE ALL ON FUNCTION public.get_queue_card_count() FROM public;
GRANT EXECUTE ON FUNCTION public.get_queue_card_count() TO anon;
GRANT EXECUTE ON FUNCTION public.get_queue_card_count() TO authenticated;
-- 5) get_my_order: attach queue_position for active cards
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
      'queue_position', (
        SELECT q.queue_position
        FROM (
          SELECT
            c2.id AS card_id,
            ROW_NUMBER() OVER (
              ORDER BY
                o2.queue_priority ASC NULLS LAST,
                o2.created_at ASC NULLS LAST,
                c2.id ASC
            )::integer AS queue_position
          FROM public.cards c2
          INNER JOIN public.orders o2 ON o2.id = c2.order_id
          WHERE o2.status IN ('new', 'in_progress')
            AND c2.status IN ('todo', 'in_progress')
        ) q
        WHERE q.card_id = card.id
          AND card.status IN ('todo', 'in_progress')
          AND v_order.status IN ('new', 'in_progress')
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
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb),
    'quote_items', coalesce(v_quote_items, '[]'::jsonb)
  );
end;
$$;
REVOKE ALL ON FUNCTION public.get_my_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_order(uuid) TO authenticated;
-- 6) Admin: list open orders for the priority queue page
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
  WHERE o.status IN ('new', 'in_progress');
$$;
REVOKE ALL ON FUNCTION public.list_queue_orders() FROM public;
GRANT EXECUTE ON FUNCTION public.list_queue_orders() TO service_role;
-- 7) Admin: reorder open orders by writing sequential queue_priority
CREATE OR REPLACE FUNCTION public.reorder_queue_orders(p_ordered_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_index integer := 0;
  v_updated integer := 0;
BEGIN
  IF p_ordered_ids IS NULL THEN
    RAISE EXCEPTION 'ordered_ids is required';
  END IF;

  FOREACH v_id IN ARRAY p_ordered_ids
  LOOP
    UPDATE public.orders
    SET queue_priority = v_index
    WHERE id = v_id
      AND status IN ('new', 'in_progress');
    IF FOUND THEN
      v_updated := v_updated + 1;
    END IF;
    v_index := v_index + 1;
  END LOOP;

  RETURN public.list_queue_orders();
END;
$$;
REVOKE ALL ON FUNCTION public.reorder_queue_orders(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_queue_orders(uuid[]) TO service_role;

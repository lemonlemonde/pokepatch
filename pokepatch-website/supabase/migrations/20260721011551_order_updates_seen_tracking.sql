-- Track when team posted updates vs when the customer last opened the order.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS updates_available_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_updates_seen_at timestamptz;

-- Existing orders that already have team photos should show the chip until opened.
UPDATE public.orders o
SET updates_available_at = coalesce(o.updates_available_at, now())
WHERE exists (
  SELECT 1
  FROM public.cards c
  JOIN public.card_images ci ON ci.card_id = c.id
  WHERE c.order_id = o.id
    AND ci.image_type <> 'customer'
);

CREATE OR REPLACE FUNCTION public.mark_my_order_updates_seen(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  update public.orders
  set customer_updates_seen_at = now()
  where id = p_order_id
    and user_id = v_user_id;

  if not found then
    raise exception 'order not found or access denied';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.mark_my_order_updates_seen(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_my_order_updates_seen(uuid) TO authenticated;

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
      'has_new_updates', (
        exists (
          select 1
          from public.cards c
          join public.card_images ci on ci.card_id = c.id
          where c.order_id = o.id
            and ci.image_type <> 'customer'
        )
        and o.updates_available_at is not null
        and (
          o.customer_updates_seen_at is null
          or o.updates_available_at > o.customer_updates_seen_at
        )
      ),
      -- Keep legacy key for older clients; same meaning as has_new_updates.
      'has_admin_photos', (
        exists (
          select 1
          from public.cards c
          join public.card_images ci on ci.card_id = c.id
          where c.order_id = o.id
            and ci.image_type <> 'customer'
        )
        and o.updates_available_at is not null
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
;

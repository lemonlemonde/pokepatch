-- PokePatch: order list photo previews
--
-- Adds `preview_paths` (up to 4 submitted card photos) and `image_count` (total
-- submitted card photos) to the get_my_orders payload so the orders list can
-- render a small preview box of the cards submitted with each order.
--
-- SAFETY
-- - Additive: only replaces the get_my_orders function.
-- - Never touches quote_requests or the *_original backup tables.
-- - Wrapped in a transaction.

begin;

do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'Refusing to apply: public.orders is missing. Run orders schema migration first.';
  end if;
end;
$$;

create or replace function public.get_my_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
      'card_count', (
        select count(*)
        from public.cards c
        where c.order_id = o.id
      ),
      'has_admin_photos', (
        select exists(
          select 1
          from public.cards c
          join public.card_images ci on ci.card_id = c.id
          where c.order_id = o.id and ci.image_type = 'admin'
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
$$;

revoke all on function public.get_my_orders() from public;
grant execute on function public.get_my_orders() to authenticated;

commit;

-- PokePatch: expose order status on My Orders
--
-- Adds `status` to the get_my_orders payload so the customer orders page can
-- group and badge orders. UI label for `new` is "To do".
--
-- Also repairs any draft rename of `new` → `todo` back to the live allowed set:
--   new | in_progress | completed | delivered
--
-- SAFETY
-- - Additive for get_my_orders; constraint repair is idempotent.
-- - Never touches quote_requests or *_original backup tables.
-- - Wrapped in a transaction.

begin;

do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'Refusing to apply: public.orders is missing.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ensure status values match what update_order already accepts
-- ---------------------------------------------------------------------------

alter table public.orders drop constraint if exists orders_status_check;

update public.orders
set status = 'new'
where status = 'todo';

alter table public.orders
  alter column status set default 'new';

alter table public.orders
  add constraint orders_status_check
  check (status in ('new', 'in_progress', 'completed', 'delivered'));

-- ---------------------------------------------------------------------------
-- get_my_orders — include status for customer My Orders sections
-- ---------------------------------------------------------------------------

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
      'status', o.status,
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

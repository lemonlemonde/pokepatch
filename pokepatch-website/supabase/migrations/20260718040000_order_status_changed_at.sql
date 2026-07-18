-- PokePatch: track when an order entered its current status
--
-- Adds orders.status_changed_at (updated whenever status changes) so the
-- admin board can sort:
--   To do        → by submitted time (created_at)
--   In progress  → by when moved into in progress (status_changed_at)
--   Completed /
--   Canceled     → by when closed (completed_at)
--
-- SAFETY
-- - Additive column + trigger; replaces get_my_orders only to expose the field.
-- - Never touches quote_requests or *_original backup tables.

begin;

do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'Refusing to apply: public.orders is missing.';
  end if;
end;
$$;

alter table public.orders
  add column if not exists status_changed_at timestamptz;

update public.orders
set status_changed_at = coalesce(completed_at, created_at, now())
where status_changed_at is null;

alter table public.orders
  alter column status_changed_at set default now();

create or replace function public.orders_touch_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.status_changed_at := coalesce(new.status_changed_at, new.created_at, now());
    return new;
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists orders_status_changed_at_trg on public.orders;

create trigger orders_status_changed_at_trg
  before insert or update of status on public.orders
  for each row
  execute function public.orders_touch_status_changed_at();

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
      'completed_at', o.completed_at,
      'status_changed_at', o.status_changed_at,
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

-- Customer accounts and order tracking
--
-- Allows customers to create accounts and track their orders.
-- Orders can be submitted without accounts, then linked later via email/contact.

begin;

-- Add user_id column to orders (nullable - orders can exist without accounts)
alter table public.orders
add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists orders_user_id_idx on public.orders(user_id);

-- Function to link orders to a user account by matching contact info
create or replace function public.claim_my_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_updated_count int := 0;
  v_order_ids uuid[];
begin
  -- Get the authenticated user
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Get user's email
  select email into v_user_email
  from auth.users
  where id = v_user_id;

  if v_user_email is null then
    raise exception 'user email not found';
  end if;

  -- Find and claim orders that match the user's email in contacts
  -- Only claim orders that don't already have a user_id
  with matching_orders as (
    select distinct o.id
    from public.orders o
    join public.contacts c on c.order_id = o.id
    where o.user_id is null
      and (
        -- Match email in contact value (case insensitive)
        lower(c.value) = lower(v_user_email)
        -- Also match if customer_name contains the email (in case they entered it there)
        or lower(o.customer_name) like '%' || lower(v_user_email) || '%'
      )
  ),
  updated as (
    update public.orders
    set user_id = v_user_id
    where id in (select id from matching_orders)
    returning id
  )
  select count(*), array_agg(id)
  into v_updated_count, v_order_ids
  from updated;

  return jsonb_build_object(
    'claimed_count', coalesce(v_updated_count, 0),
    'order_ids', coalesce(v_order_ids, array[]::uuid[])
  );
end;
$$;

-- Grant execute to authenticated users
revoke all on function public.claim_my_orders() from public;
grant execute on function public.claim_my_orders() to authenticated;

-- Function to get order details for a customer
create or replace function public.get_my_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_order public.orders%rowtype;
  v_contacts jsonb;
  v_cards jsonb;
  v_result jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Get order (verify ownership)
  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id;

  if not found then
    raise exception 'order not found or access denied';
  end if;

  -- Get contacts
  select jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'contact_type', c.contact_type,
      'value', c.value
    )
  ) into v_contacts
  from public.contacts c
  where c.order_id = v_order.id;

  -- Get cards with images
  select jsonb_agg(
    jsonb_build_object(
      'id', card.id,
      'card_name', card.card_name,
      'set_name', card.set_name,
      'description', card.description,
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
  ) into v_cards
  from public.cards card
  where card.order_id = v_order.id;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes,
    'contacts', coalesce(v_contacts, '[]'::jsonb),
    'cards', coalesce(v_cards, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_order(uuid) from public;
grant execute on function public.get_my_order(uuid) to authenticated;

-- Function to list all orders for the authenticated user
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

-- RLS policies for customers to view their own orders
-- (Orders are still world-writable via create_order function for anon users)

-- Note: The create_order function already has EXECUTE granted to anon,
-- so we don't need additional RLS policies for order insertion.

-- These policies are for customers to READ their own orders:
create policy "users can view their own orders"
  on public.orders for select
  to authenticated
  using (user_id = auth.uid());

create policy "users can view contacts for their orders"
  on public.contacts for select
  to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = contacts.order_id
        and orders.user_id = auth.uid()
    )
  );

create policy "users can view cards for their orders"
  on public.cards for select
  to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = cards.order_id
        and orders.user_id = auth.uid()
    )
  );

create policy "users can view images for their orders"
  on public.card_images for select
  to authenticated
  using (
    exists (
      select 1 from public.cards
      join public.orders on orders.id = cards.order_id
      where cards.id = card_images.card_id
        and orders.user_id = auth.uid()
    )
  );

commit;

-- PokePatch: orders relational schema (working + original backup)
--
-- SAFETY GUARANTEES
-- - Fully additive: only CREATE new tables/indexes/functions.
-- - Never references, alters, drops, or truncates quote_requests.
-- - Never modifies storage.objects or existing policies.
-- - Wrapped in a single transaction: failure rolls back everything
--   (no partial / broken intermediate schema).
-- - Idempotent: safe to re-run (IF NOT EXISTS / CREATE OR REPLACE).
--
-- Historical quote_requests rows and the legacy INSERT webhook are untouched.
-- Run in Supabase SQL Editor, or via: supabase db push

begin;

-- Refuse to proceed if we somehow lost historical data (should never happen).
-- This does not modify quote_requests; it only aborts if the table is missing.
do $$
begin
  if to_regclass('public.quote_requests') is null then
    raise exception
      'Refusing to apply orders schema: public.quote_requests is missing. Historical data may be at risk; restore it before continuing.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Working tables (new only)
-- ---------------------------------------------------------------------------

create table if not exists public.orders (
  id uuid primary key,
  display_id bigint generated always as identity,
  created_at timestamptz not null default now(),
  customer_name text not null,
  delivery_method text not null
    check (delivery_method in ('local_dropoff', 'shipping')),
  general_notes text
);

create table if not exists public.contacts (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  contact_type text not null
    check (contact_type in ('phone', 'discord', 'instagram')),
  value text not null
);

create table if not exists public.cards (
  id uuid primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  card_name text not null,
  set_name text,
  description text
);

create table if not exists public.card_images (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards (id) on delete cascade,
  image_type text not null default 'customer'
    check (image_type in ('customer', 'admin')),
  storage_path text not null
);

create index if not exists contacts_order_id_idx on public.contacts (order_id);
create index if not exists cards_order_id_idx on public.cards (order_id);
create index if not exists card_images_card_id_idx on public.card_images (card_id);

-- ---------------------------------------------------------------------------
-- Original backup tables (immutable after create_order)
-- ---------------------------------------------------------------------------

create table if not exists public.orders_original (
  id uuid primary key,
  display_id bigint not null,
  created_at timestamptz not null,
  customer_name text not null,
  delivery_method text not null
    check (delivery_method in ('local_dropoff', 'shipping')),
  general_notes text
);

create table if not exists public.contacts_original (
  id bigint primary key,
  order_id uuid not null references public.orders_original (id) on delete cascade,
  contact_type text not null
    check (contact_type in ('phone', 'discord', 'instagram')),
  value text not null
);

create table if not exists public.cards_original (
  id uuid primary key,
  order_id uuid not null references public.orders_original (id) on delete cascade,
  card_name text not null,
  set_name text,
  description text
);

create table if not exists public.card_images_original (
  id bigint primary key,
  card_id uuid not null references public.cards_original (id) on delete cascade,
  image_type text not null default 'customer'
    check (image_type in ('customer', 'admin')),
  storage_path text not null
);

create index if not exists contacts_original_order_id_idx on public.contacts_original (order_id);
create index if not exists cards_original_order_id_idx on public.cards_original (order_id);
create index if not exists card_images_original_card_id_idx on public.card_images_original (card_id);

-- ---------------------------------------------------------------------------
-- RLS on NEW tables only (idempotent; does not touch quote_requests RLS)
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.contacts enable row level security;
alter table public.cards enable row level security;
alter table public.card_images enable row level security;
alter table public.orders_original enable row level security;
alter table public.contacts_original enable row level security;
alter table public.cards_original enable row level security;
alter table public.card_images_original enable row level security;

-- ---------------------------------------------------------------------------
-- create_order: public form, one-shot submission + original backup
-- ---------------------------------------------------------------------------

create or replace function public.create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_customer_name text;
  v_delivery_method text;
  v_contacts jsonb;
  v_cards jsonb;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_card_id uuid;
  v_card_name text;
  v_images jsonb;
  v_contact_count int;
  v_card_count int;
  v_image_count int;
  v_order public.orders%rowtype;
  v_contact_row public.contacts%rowtype;
  v_card_row public.cards%rowtype;
  v_image_row public.card_images%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload is required';
  end if;

  begin
    v_order_id := (p_payload ->> 'id')::uuid;
  exception
    when others then
      raise exception 'order id must be a valid uuid';
  end;

  if v_order_id is null then
    raise exception 'order id is required';
  end if;

  v_customer_name := trim(coalesce(p_payload ->> 'customer_name', ''));
  if v_customer_name = '' then
    raise exception 'customer_name is required';
  end if;

  v_delivery_method := p_payload ->> 'delivery_method';
  if v_delivery_method is null
     or v_delivery_method not in ('local_dropoff', 'shipping') then
    raise exception 'delivery_method must be local_dropoff or shipping';
  end if;

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  if jsonb_typeof(v_contacts) <> 'array' then
    raise exception 'contacts must be an array';
  end if;

  v_contact_count := jsonb_array_length(v_contacts);
  if v_contact_count < 1 then
    raise exception 'at least one contact is required';
  end if;

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  if jsonb_typeof(v_cards) <> 'array' then
    raise exception 'cards must be an array';
  end if;

  v_card_count := jsonb_array_length(v_cards);
  if v_card_count < 1 then
    raise exception 'at least one card is required';
  end if;
  if v_card_count > 10 then
    raise exception 'at most 10 cards are allowed';
  end if;

  -- Validate contacts
  for v_contact in select * from jsonb_array_elements(v_contacts)
  loop
    if coalesce(v_contact ->> 'contact_type', '') not in ('phone', 'discord', 'instagram') then
      raise exception 'invalid contact_type';
    end if;
    if trim(coalesce(v_contact ->> 'value', '')) = '' then
      raise exception 'contact value is required';
    end if;
  end loop;

  -- Validate cards and images
  for v_card in select * from jsonb_array_elements(v_cards)
  loop
    begin
      v_card_id := (v_card ->> 'id')::uuid;
    exception
      when others then
        raise exception 'card id must be a valid uuid';
    end;
    if v_card_id is null then
      raise exception 'card id is required';
    end if;

    v_card_name := trim(coalesce(v_card ->> 'card_name', ''));
    if v_card_name = '' then
      raise exception 'card_name is required';
    end if;

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    if jsonb_typeof(v_images) <> 'array' then
      raise exception 'card images must be an array';
    end if;

    v_image_count := jsonb_array_length(v_images);
    if v_image_count < 1 then
      raise exception 'each card requires at least one image';
    end if;

    for v_image in select * from jsonb_array_elements(v_images)
    loop
      if trim(coalesce(v_image ->> 'storage_path', '')) = '' then
        raise exception 'image storage_path is required';
      end if;
      if coalesce(v_image ->> 'image_type', 'customer') not in ('customer', 'admin') then
        raise exception 'invalid image_type';
      end if;
    end loop;
  end loop;

  -- Working order, then original order (FK parent for other originals)
  insert into public.orders (id, customer_name, delivery_method, general_notes)
  values (v_order_id, v_customer_name, v_delivery_method, null)
  returning * into v_order;

  insert into public.orders_original (
    id, display_id, created_at, customer_name, delivery_method, general_notes
  )
  values (
    v_order.id,
    v_order.display_id,
    v_order.created_at,
    v_order.customer_name,
    v_order.delivery_method,
    v_order.general_notes
  );

  -- Working contacts + original contacts (same ids)
  for v_contact in select * from jsonb_array_elements(v_contacts)
  loop
    insert into public.contacts (order_id, contact_type, value)
    values (
      v_order_id,
      v_contact ->> 'contact_type',
      trim(v_contact ->> 'value')
    )
    returning * into v_contact_row;

    insert into public.contacts_original (id, order_id, contact_type, value)
    values (
      v_contact_row.id,
      v_order_id,
      v_contact_row.contact_type,
      v_contact_row.value
    );
  end loop;

  -- Working cards + images, then originals
  for v_card in select * from jsonb_array_elements(v_cards)
  loop
    v_card_id := (v_card ->> 'id')::uuid;

    insert into public.cards (id, order_id, card_name, set_name, description)
    values (
      v_card_id,
      v_order_id,
      trim(v_card ->> 'card_name'),
      nullif(trim(coalesce(v_card ->> 'set_name', '')), ''),
      nullif(trim(coalesce(v_card ->> 'description', '')), '')
    )
    returning * into v_card_row;

    insert into public.cards_original (id, order_id, card_name, set_name, description)
    values (
      v_card_row.id,
      v_order_id,
      v_card_row.card_name,
      v_card_row.set_name,
      v_card_row.description
    );

    v_images := coalesce(v_card -> 'images', '[]'::jsonb);
    for v_image in select * from jsonb_array_elements(v_images)
    loop
      insert into public.card_images (card_id, image_type, storage_path)
      values (
        v_card_id,
        coalesce(v_image ->> 'image_type', 'customer'),
        trim(v_image ->> 'storage_path')
      )
      returning * into v_image_row;

      insert into public.card_images_original (id, card_id, image_type, storage_path)
      values (
        v_image_row.id,
        v_image_row.card_id,
        v_image_row.image_type,
        v_image_row.storage_path
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method
  );
end;
$$;

revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon;
grant execute on function public.create_order(jsonb) to authenticated;
grant execute on function public.create_order(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- update_order: admin-only, working tables only (never touches *_original
-- or quote_requests)
-- ---------------------------------------------------------------------------

create or replace function public.update_order(
  p_order_id uuid,
  p_order jsonb default null,
  p_contacts jsonb default null,
  p_cards jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_contact_id bigint;
  v_card_id uuid;
  v_images jsonb;
  v_contact_type text;
  v_value text;
  v_card_name text;
  v_set_name text;
  v_description text;
begin
  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  -- Patch order fields
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
  end if;

  -- Contacts: insert (no id) or update (with id)
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

  -- Cards: insert (no id) or update (with id); images append
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

        insert into public.cards (id, order_id, card_name, set_name, description)
        values (v_card_id, p_order_id, v_card_name, v_set_name, v_description);
      end if;

      if jsonb_typeof(v_images) = 'array' then
        for v_image in select * from jsonb_array_elements(v_images)
        loop
          if trim(coalesce(v_image ->> 'storage_path', '')) = '' then
            raise exception 'image storage_path is required';
          end if;
          if coalesce(v_image ->> 'image_type', 'customer') not in ('customer', 'admin') then
            raise exception 'invalid image_type';
          end if;

          insert into public.card_images (card_id, image_type, storage_path)
          values (
            v_card_id,
            coalesce(v_image ->> 'image_type', 'customer'),
            trim(v_image ->> 'storage_path')
          );
        end loop;
      end if;
    end loop;
  end if;

  select * into v_order from public.orders where id = p_order_id;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes
  );
end;
$$;

revoke all on function public.update_order(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.update_order(uuid, jsonb, jsonb, jsonb) to service_role;

-- Final guard: quote_requests must still exist after this migration.
do $$
begin
  if to_regclass('public.quote_requests') is null then
    raise exception
      'Migration aborted: public.quote_requests disappeared during apply. Rolling back.';
  end if;
end;
$$;

commit;

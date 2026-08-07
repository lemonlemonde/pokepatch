-- Baseline: the live schema as it stood before the oldest surviving migration.
--
-- Migration history was truncated once, which left the oldest remaining file
-- (20260721011551_order_updates_seen_tracking.sql) doing ALTER TABLE
-- public.orders against a table nothing in this directory ever creates. The
-- files could not build a database from scratch, so `supabase start` failed on
-- the first migration and there was no way to run the app locally.
--
-- This is `supabase db dump --linked` output, timestamped ahead of every other
-- migration. The 39 migrations after it then replay onto it; verified that the
-- resulting local schema matches the hosted one.
--
-- It is recorded as already-applied on the hosted project (via
-- `supabase migration repair`), so `db push` never runs it there. Nothing in
-- here should ever execute against the live database.
--
-- Do not edit. New schema changes go in a new migration, as always.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cards_assign_sort_order"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.sort_order is null then
    select coalesce(max(c.sort_order), -1) + 1
      into new.sort_order
    from public.cards c
    where c.order_id = new.order_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."cards_assign_sort_order"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_my_orders"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  -- Find and claim orders that match the user's email
  -- Only claim orders that don't already have a user_id
  with matching_orders as (
    select id
    from public.orders
    where user_id is null
      and lower(customer_email) = lower(v_user_email)
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


ALTER FUNCTION "public"."claim_my_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order_id uuid;
  v_user_id uuid;
  v_first_name text;
  v_last_name text;
  v_customer_name text;
  v_customer_email text;
  v_delivery_method text;
  v_heard_about_source text;
  v_preferred_type text;
  v_preferred_value text;
  v_contacts jsonb;
  v_cards jsonb;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_card_id uuid;
  v_card_name text;
  v_images jsonb;
  v_card_count int;
  v_image_count int;
  v_account_user_id uuid;
  v_account_first_name text;
  v_account_last_name text;
  v_order public.orders%rowtype;
  v_contact_row public.contacts%rowtype;
  v_card_row public.cards%rowtype;
  v_image_row public.card_images%rowtype;
  v_is_priority boolean;
  v_priority_fee numeric(10, 2);
  v_quote_bulk jsonb;
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

  v_user_id := auth.uid();

  v_first_name := trim(coalesce(p_payload ->> 'first_name', ''));
  if v_first_name = '' then
    raise exception 'first_name is required';
  end if;

  v_last_name := trim(coalesce(p_payload ->> 'last_name', ''));
  if v_last_name = '' then
    raise exception 'last_name is required';
  end if;

  v_customer_email := trim(coalesce(p_payload ->> 'customer_email', ''));
  if v_customer_email = '' then
    raise exception 'customer_email is required';
  end if;

  -- If this email (or session) already belongs to an account with a saved
  -- name, that name wins over whatever was typed on this particular
  -- submission — logged in or anonymous with a matching email.
  v_account_user_id := v_user_id;
  if v_account_user_id is null then
    select u.id into v_account_user_id
    from auth.users u
    where lower(u.email) = lower(v_customer_email)
    limit 1;
  end if;

  if v_account_user_id is not null then
    select first_name, last_name into v_account_first_name, v_account_last_name
    from public.customer_profiles
    where user_id = v_account_user_id;

    -- Only override a side that the account actually has a value for — an
    -- account with just a first name saved should never blank out a
    -- genuinely-submitted last name on this new order.
    if coalesce(v_account_first_name, '') <> '' then
      v_first_name := v_account_first_name;
    end if;
    if coalesce(v_account_last_name, '') <> '' then
      v_last_name := v_account_last_name;
    end if;
  end if;

  -- If the submitter is logged in and their own account is missing a side
  -- of the name, save whatever they just typed for that side back onto the
  -- account now — otherwise a customer whose account only has a first name
  -- would be asked to retype their last name on every single quote, and
  -- their account page would stay blank even after they've told us. Never
  -- do this for an anonymous submission that merely matched an email —
  -- only the account's own logged-in session may write to its profile.
  if v_user_id is not null then
    insert into public.customer_profiles (user_id, first_name, last_name, updated_at)
    values (v_user_id, v_first_name, v_last_name, now())
    on conflict (user_id) do update
    set
      first_name = case
        when coalesce(public.customer_profiles.first_name, '') = ''
          then excluded.first_name
        else public.customer_profiles.first_name
      end,
      last_name = case
        when coalesce(public.customer_profiles.last_name, '') = ''
          then excluded.last_name
        else public.customer_profiles.last_name
      end,
      updated_at = now()
    where
      coalesce(public.customer_profiles.first_name, '') = ''
      or coalesce(public.customer_profiles.last_name, '') = '';
  end if;

  v_customer_name := trim(v_first_name || ' ' || v_last_name);

  v_delivery_method := p_payload ->> 'delivery_method';
  if v_delivery_method is null
     or v_delivery_method not in ('local_dropoff', 'shipping') then
    raise exception 'delivery_method must be local_dropoff or shipping';
  end if;

  v_heard_about_source := nullif(trim(coalesce(p_payload ->> 'heard_about_source', '')), '');

  v_contacts := coalesce(p_payload -> 'contacts', '[]'::jsonb);
  if jsonb_typeof(v_contacts) <> 'array' then
    raise exception 'contacts must be an array';
  end if;

  v_cards := coalesce(p_payload -> 'cards', '[]'::jsonb);
  if jsonb_typeof(v_cards) <> 'array' then
    raise exception 'cards must be an array';
  end if;

  v_card_count := jsonb_array_length(v_cards);
  if v_card_count < 1 then
    raise exception 'at least one card is required';
  end if;

  for v_contact in select * from jsonb_array_elements(v_contacts)
  loop
    if coalesce(v_contact ->> 'contact_type', '') not in ('phone', 'discord', 'instagram') then
      raise exception 'invalid contact_type';
    end if;
    if trim(coalesce(v_contact ->> 'value', '')) = '' then
      raise exception 'contact value is required';
    end if;
  end loop;

  v_preferred_type := coalesce(nullif(trim(coalesce(p_payload ->> 'preferred_contact_type', '')), ''), 'email');
  if v_preferred_type not in ('email', 'phone', 'discord', 'instagram') then
    raise exception 'invalid preferred_contact_type';
  end if;

  if v_preferred_type = 'email' then
    v_preferred_value := v_customer_email;
  else
    v_preferred_value := trim(coalesce(p_payload ->> 'preferred_contact_value', ''));
    if v_preferred_value = '' then
      raise exception 'preferred_contact_value is required';
    end if;
  end if;

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

  v_is_priority := coalesce((p_payload ->> 'is_priority')::boolean, false);

  v_quote_bulk := null;
  if v_is_priority then
    v_priority_fee := (
      25 + greatest(0, v_card_count - 1) * 10
    )::numeric(10, 2);
    v_quote_bulk := jsonb_build_object(
      'version', 2,
      'adjustments', jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'kind', 'surcharge',
          'description', 'Priority service',
          'amount_dollars', v_priority_fee,
          'amount_percent', null
        )
      )
    );
  end if;

  insert into public.orders (
    id, user_id, first_name, last_name, customer_name, customer_email, delivery_method, general_notes,
    heard_about_source, preferred_contact_type, preferred_contact_value, status, pending_kind, is_priority,
    quote_bulk_counts
  )
  values (
    v_order_id, v_user_id, v_first_name, v_last_name, v_customer_name, v_customer_email, v_delivery_method, null,
    v_heard_about_source, v_preferred_type, v_preferred_value, 'pending', 'quote', v_is_priority,
    v_quote_bulk
  )
  returning * into v_order;

  insert into public.orders_original (
    id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes
  )
  values (
    v_order.id,
    v_order.display_id,
    v_order.created_at,
    v_order.first_name,
    v_order.last_name,
    v_order.customer_name,
    v_order.delivery_method,
    v_order.general_notes
  );

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


ALTER FUNCTION "public"."create_order"("p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."customer_messages_restrict_customer_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- customer_messages guard: customers may only update read_at
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id
      or new.recipient_email is distinct from old.recipient_email
      or new.user_id is distinct from old.user_id
      or new.order_id is distinct from old.order_id
      or new.subject is distinct from old.subject
      or new.body is distinct from old.body
      or new.changelog is distinct from old.changelog
      or new.sent_at is distinct from old.sent_at
      or new.email_status is distinct from old.email_status
      or new.email_error is distinct from old.email_error
      or new.batch_id is distinct from old.batch_id
    then
      raise exception 'customers may only update read_at on their messages';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."customer_messages_restrict_customer_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."email_has_account"("p_email" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_email text;
  v_recent_lookups int;
begin
  v_email := lower(trim(coalesce(p_email, '')));

  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return false;
  end if;

  -- Nothing outside the throttle window is ever read, so drop it. Without this
  -- the table grows one row per lookup forever, and anon drives the inserts.
  -- ponytail: swept inline on every call rather than on a schedule — cheap
  -- because it runs constantly and so finds little, but it is one extra write
  -- per lookup. Move to pg_cron if lookup volume ever makes that matter.
  delete from public.account_lookup_log
   where looked_up_at <= now() - interval '1 hour';

  -- Throttle repeated probing of the same address. The caller treats an
  -- exception as "couldn't check" and lets the submission through, so a
  -- throttled visitor is never blocked from ordering.
  select count(*)
    into v_recent_lookups
    from public.account_lookup_log
   where email = v_email
     and looked_up_at > now() - interval '1 hour';

  if v_recent_lookups >= 10 then
    raise exception 'too many account lookups for this email; try again later';
  end if;

  insert into public.account_lookup_log (email) values (v_email);

  return exists (
    select 1 from auth.users
     where lower(email) = v_email
       and deleted_at is null
  );
end;
$_$;


ALTER FUNCTION "public"."email_has_account"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_order"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_my_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_orders"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_my_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_unread_message_count"() RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select count(*)::bigint
  from public.customer_messages cm
  where cm.read_at is null
    and (
      cm.user_id = auth.uid()
      or exists (
        select 1
        from public.orders o
        where o.id = cm.order_id
          and o.user_id = auth.uid()
      )
    );
$$;


ALTER FUNCTION "public"."get_my_unread_message_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_queue_card_count"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'todo',
    (
      SELECT count(*)::integer
      FROM public.cards c
      INNER JOIN public.orders o ON o.id = c.order_id
      WHERE c.status = 'todo'
        AND o.status IN ('new', 'pending')
    ),
    'in_progress',
    (
      SELECT count(*)::integer
      FROM public.cards c
      WHERE c.status = 'in_progress'
    ),
    'completed',
    (
      SELECT count(*)::integer
      FROM public.cards c
      WHERE c.status = 'completed'
    )
  );
$$;


ALTER FUNCTION "public"."get_queue_card_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_queue_orders"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."list_queue_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_my_messages_read"("p_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  updated_count bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.customer_messages cm
  set read_at = now()
  where cm.read_at is null
    and (p_ids is null or cm.id = any (p_ids))
    and (
      cm.user_id = auth.uid()
      or exists (
        select 1
        from public.orders o
        where o.id = cm.order_id
          and o.user_id = auth.uid()
      )
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;


ALTER FUNCTION "public"."mark_my_messages_read"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_order_in_status"("p_order_id" "uuid", "p_status" "text", "p_queue_index" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."move_order_in_status"("p_order_id" "uuid", "p_status" "text", "p_queue_index" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."orders_set_queue_priority"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.queue_priority := NULL;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."orders_set_queue_priority"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."orders_touch_status_changed_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."orders_touch_status_changed_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_queue_orders"("p_ordered_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN public.list_queue_orders();
END;
$$;


ALTER FUNCTION "public"."reorder_queue_orders"("p_ordered_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_status_orders"("p_status" "text", "p_ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Manual reorder removed; queue order is is_priority then created_at.
  RETURN;
END;
$$;


ALTER FUNCTION "public"."reorder_status_orders"("p_status" "text", "p_ordered_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profile_name_from_latest_order"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_customer_name text;
  v_existing_first_name text;
  v_existing_last_name text;
  v_metadata_first_name text;
  v_metadata_last_name text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select first_name, last_name into v_existing_first_name, v_existing_last_name
  from public.customer_profiles
  where user_id = v_user_id;

  -- Never clobber a name the customer already has on their account.
  if coalesce(v_existing_first_name, '') <> '' or coalesce(v_existing_last_name, '') <> '' then
    return jsonb_build_object('updated', false);
  end if;

  -- Prefer the name collected at signup (now required there) over guessing
  -- from past orders — that guess only matters for accounts created before
  -- signup required a name.
  v_metadata_first_name := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'first_name', '')), '');
  v_metadata_last_name := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'last_name', '')), '');

  if v_metadata_first_name is not null or v_metadata_last_name is not null then
    v_first_name := v_metadata_first_name;
    v_last_name := v_metadata_last_name;
  else
    v_email := lower(trim(coalesce(auth.email(), '')));
    if v_email <> '' then
      select
        nullif(trim(coalesce(o.first_name, '')), ''),
        nullif(trim(coalesce(o.last_name, '')), ''),
        nullif(trim(coalesce(o.customer_name, '')), '')
      into v_first_name, v_last_name, v_customer_name
      from public.orders o
      where lower(o.customer_email) = v_email
        and (
          coalesce(o.first_name, '') <> ''
          or coalesce(o.last_name, '') <> ''
          or coalesce(o.customer_name, '') <> ''
        )
      order by o.created_at desc
      limit 1;

      -- Pre-split orders only stored customer_name; treat it as first name.
      if coalesce(v_first_name, '') = '' and coalesce(v_last_name, '') = '' then
        v_first_name := v_customer_name;
      end if;
    end if;
  end if;

  if coalesce(v_first_name, '') = '' and coalesce(v_last_name, '') = '' then
    return jsonb_build_object('updated', false);
  end if;

  insert into public.customer_profiles (user_id, first_name, last_name, updated_at)
  values (v_user_id, v_first_name, v_last_name, now())
  on conflict (user_id) do update
  set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    updated_at = now()
  where
    coalesce(public.customer_profiles.first_name, '') = ''
    and coalesce(public.customer_profiles.last_name, '') = '';

  return jsonb_build_object(
    'updated', true,
    'first_name', v_first_name,
    'last_name', v_last_name
  );
end;
$$;


ALTER FUNCTION "public"."sync_profile_name_from_latest_order"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_order"("p_order_id" "uuid", "p_order" "jsonb" DEFAULT NULL::"jsonb", "p_contacts" "jsonb" DEFAULT NULL::"jsonb", "p_cards" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_order public.orders%rowtype;
  v_contact jsonb;
  v_card jsonb;
  v_image jsonb;
  v_quote_item jsonb;
  v_quote_items jsonb;
  v_contact_id bigint;
  v_card_id uuid;
  v_quote_id uuid;
  v_images jsonb;
  v_contact_type text;
  v_value text;
  v_card_name text;
  v_set_name text;
  v_description text;
  v_admin_note text;
  v_card_checklist jsonb;
  v_market_value numeric(10, 2);
  v_card_status text;
  v_prev_card_status text;
  v_card_status_changed boolean := false;
  v_status text;
  v_prev_status text;
  v_pending_kind text;
  v_image_type text;
  v_drive_url text;
  v_override_label text;
  v_override_amount numeric(10, 2);
  v_bulk_counts jsonb;
  v_service_key text;
  v_service_label text;
  v_base_amount numeric(10, 2);
  v_hv_surcharge numeric(10, 2);
  v_sort_order int;
  v_card_sort int;
  v_kept_card_ids uuid[] := '{}';
  v_allowed_image_types text[] := array[
    'customer', 'admin',
    'progress_front', 'progress_back',
    'final_front', 'final_back'
  ];
begin
  if p_order_id is null then
    raise exception 'order id is required';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  v_prev_status := v_order.status;

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


    if p_order ? 'is_priority' then
      update public.orders
      set is_priority = coalesce((p_order ->> 'is_priority')::boolean, false)
      where id = p_order_id;
    end if;

    if p_order ? 'photos_drive_url' then
      v_drive_url := nullif(trim(coalesce(p_order ->> 'photos_drive_url', '')), '');
      update public.orders
      set photos_drive_url = v_drive_url
      where id = p_order_id;
    end if;

    if p_order ? 'quote_bulk_counts' then
      if p_order -> 'quote_bulk_counts' is null
         or p_order ->> 'quote_bulk_counts' is null
         or p_order ->> 'quote_bulk_counts' = 'null'
         or p_order ->> 'quote_bulk_counts' = '' then
        update public.orders
        set quote_bulk_counts = null
        where id = p_order_id;
      else
        if jsonb_typeof(p_order -> 'quote_bulk_counts') <> 'object' then
          raise exception 'quote_bulk_counts must be an object';
        end if;
        v_bulk_counts := p_order -> 'quote_bulk_counts';
        update public.orders
        set quote_bulk_counts = v_bulk_counts
        where id = p_order_id;
      end if;
    end if;

    if p_order ? 'quote_override_label' or p_order ? 'quote_override_amount' then
      v_override_label := nullif(
        trim(coalesce(p_order ->> 'quote_override_label', '')),
        ''
      );

      if p_order ->> 'quote_override_amount' is null
         or trim(coalesce(p_order ->> 'quote_override_amount', '')) = '' then
        v_override_amount := null;
      else
        begin
          v_override_amount := (p_order ->> 'quote_override_amount')::numeric(10, 2);
        exception
          when others then
            raise exception 'quote_override_amount must be a number';
        end;
      end if;

      if (v_override_label is null) <> (v_override_amount is null) then
        raise exception 'quote override requires both label and amount, or neither';
      end if;

      update public.orders
      set
        quote_override_label = v_override_label,
        quote_override_amount = v_override_amount
      where id = p_order_id;
    end if;

    if p_order ? 'status' then
      v_status := p_order ->> 'status';
      if v_status = 'delivered' then
        v_status := 'completed';
      end if;
      if v_status = 'cancelled' then
        v_status := 'canceled';
      end if;
      if v_status in ('on_hold', 'pending_quote', 'pending_dropoff') then
        v_status := 'pending';
      end if;
      if v_status = 'ready_for_customer' then
        v_status := 'ready';
      end if;
      if v_status not in ('new', 'pending', 'in_progress', 'ready', 'completed', 'canceled') then
        raise exception 'invalid status';
      end if;

      update public.orders
      set
        status = v_status,
        pending_kind = case
          when v_status = 'pending' then coalesce(
            nullif(trim(coalesce(p_order ->> 'pending_kind', '')), ''),
            pending_kind,
            'quote'
          )
          else null
        end,
        completed_at = case
          when v_status in ('completed', 'canceled')
               and v_prev_status is distinct from v_status
               and v_prev_status not in ('completed', 'canceled')
            then now()
          when v_status in ('completed', 'canceled')
               and v_prev_status in ('completed', 'canceled')
            then completed_at
          when v_status in ('completed', 'canceled')
            then coalesce(completed_at, now())
          else null
        end
      where id = p_order_id;
    elsif p_order ? 'pending_kind' then
      if v_prev_status is distinct from 'pending'
         and v_prev_status is distinct from 'on_hold' then
        raise exception 'pending_kind only applies to pending orders';
      end if;
      v_pending_kind := trim(coalesce(p_order ->> 'pending_kind', ''));
      if v_pending_kind not in ('quote', 'drop_off') then
        raise exception 'pending_kind must be quote or drop_off';
      end if;
      update public.orders
      set pending_kind = v_pending_kind
      where id = p_order_id;
    end if;

    if p_order ? 'quote_items' then
      v_quote_items := p_order -> 'quote_items';
      if v_quote_items is null or jsonb_typeof(v_quote_items) <> 'array' then
        raise exception 'quote_items must be an array';
      end if;

      delete from public.order_quote_items qi where qi.order_id = p_order_id;

      v_sort_order := 0;
      for v_quote_item in select * from jsonb_array_elements(v_quote_items)
      loop
        v_card_name := trim(coalesce(v_quote_item ->> 'card_name', ''));
        if v_card_name = '' then
          raise exception 'quote item card_name is required';
        end if;

        v_set_name := nullif(trim(coalesce(v_quote_item ->> 'set_name', '')), '');
        v_service_key := trim(coalesce(v_quote_item ->> 'service_key', ''));
        if v_service_key = '' then
          raise exception 'quote item service_key is required';
        end if;

        v_service_label := trim(coalesce(v_quote_item ->> 'service_label', ''));
        if v_service_label = '' then
          raise exception 'quote item service_label is required';
        end if;

        begin
          v_base_amount := (v_quote_item ->> 'quote_base_amount')::numeric(10, 2);
        exception
          when others then
            raise exception 'quote item quote_base_amount must be a number';
        end;

        if v_quote_item ->> 'high_value_surcharge' is null
           or trim(coalesce(v_quote_item ->> 'high_value_surcharge', '')) = '' then
          v_hv_surcharge := null;
        else
          begin
            v_hv_surcharge := (v_quote_item ->> 'high_value_surcharge')::numeric(10, 2);
          exception
            when others then
              raise exception 'quote item high_value_surcharge must be a number';
          end;
        end if;

        v_quote_id := null;
        if v_quote_item ? 'id' and v_quote_item ->> 'id' is not null then
          begin
            v_quote_id := (v_quote_item ->> 'id')::uuid;
          exception
            when others then
              v_quote_id := null;
          end;
        end if;
        if v_quote_id is null then
          v_quote_id := gen_random_uuid();
        end if;

        insert into public.order_quote_items (
          id,
          order_id,
          sort_order,
          card_name,
          set_name,
          service_key,
          service_label,
          quote_base_amount,
          high_value_surcharge
        )
        values (
          v_quote_id,
          p_order_id,
          v_sort_order,
          v_card_name,
          v_set_name,
          v_service_key,
          v_service_label,
          v_base_amount,
          v_hv_surcharge
        );

        v_sort_order := v_sort_order + 1;
      end loop;
    end if;
  end if;

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

  if p_cards is not null then
    if jsonb_typeof(p_cards) <> 'array' then
      raise exception 'cards must be an array';
    end if;

    v_card_sort := 0;
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

        if v_card ? 'admin_note' then
          update public.cards
          set admin_note = nullif(trim(coalesce(v_card ->> 'admin_note', '')), '')
          where id = v_card_id;
        end if;

        if v_card ? 'market_value_raw_nm' then
          if v_card ->> 'market_value_raw_nm' is null
             or trim(coalesce(v_card ->> 'market_value_raw_nm', '')) = '' then
            v_market_value := null;
          else
            begin
              v_market_value := (v_card ->> 'market_value_raw_nm')::numeric(10, 2);
            exception
              when others then
                raise exception 'card market_value_raw_nm must be a number';
            end;
            if v_market_value < 0 then
              raise exception 'card market_value_raw_nm cannot be negative';
            end if;
          end if;
          update public.cards
          set market_value_raw_nm = v_market_value
          where id = v_card_id;
        end if;

        if v_card ? 'status' then
          v_card_status := trim(coalesce(v_card ->> 'status', ''));
          if v_card_status = 'new' then
            v_card_status := 'todo';
          end if;
          if v_card_status = 'cancelled' then
            v_card_status := 'canceled';
          end if;
          if v_card_status not in ('todo', 'in_progress', 'completed', 'canceled') then
            raise exception 'invalid card status';
          end if;
          select status into v_prev_card_status
          from public.cards
          where id = v_card_id;
          if v_prev_card_status is distinct from v_card_status then
            v_card_status_changed := true;
          end if;
          update public.cards
          set status = v_card_status
          where id = v_card_id;
        end if;

        if v_card ? 'checklist' then
          if jsonb_typeof(v_card -> 'checklist') <> 'object' then
            raise exception 'card checklist must be an object';
          end if;
          update public.cards
          set checklist = v_card -> 'checklist'
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
        v_admin_note := nullif(trim(coalesce(v_card ->> 'admin_note', '')), '');

        if v_card ->> 'market_value_raw_nm' is null
           or trim(coalesce(v_card ->> 'market_value_raw_nm', '')) = '' then
          v_market_value := null;
        else
          begin
            v_market_value := (v_card ->> 'market_value_raw_nm')::numeric(10, 2);
          exception
            when others then
              raise exception 'card market_value_raw_nm must be a number';
          end;
          if v_market_value < 0 then
            raise exception 'card market_value_raw_nm cannot be negative';
          end if;
        end if;

        v_card_status := trim(coalesce(v_card ->> 'status', 'todo'));
        if v_card_status = '' then
          v_card_status := 'todo';
        end if;
        if v_card_status = 'new' then
          v_card_status := 'todo';
        end if;
        if v_card_status = 'cancelled' then
          v_card_status := 'canceled';
        end if;
        if v_card_status not in ('todo', 'in_progress', 'completed', 'canceled') then
          raise exception 'invalid card status';
        end if;

        if v_card ? 'checklist' and jsonb_typeof(v_card -> 'checklist') = 'object' then
          v_card_checklist := v_card -> 'checklist';
        else
          v_card_checklist := '{}'::jsonb;
        end if;

        insert into public.cards (
          id,
          order_id,
          card_name,
          set_name,
          description,
          admin_note,
          market_value_raw_nm,
          status,
          sort_order,
          checklist
        )
        values (
          v_card_id,
          p_order_id,
          v_card_name,
          v_set_name,
          v_description,
          v_admin_note,
          v_market_value,
          v_card_status,
          v_card_sort,
          v_card_checklist
        );
      end if;

      update public.cards
      set sort_order = v_card_sort
      where id = v_card_id;

      v_kept_card_ids := array_append(v_kept_card_ids, v_card_id);
      v_card_sort := v_card_sort + 1;

      if jsonb_typeof(v_images) = 'array' then
        for v_image in select * from jsonb_array_elements(v_images)
        loop
          if trim(coalesce(v_image ->> 'storage_path', '')) = '' then
            raise exception 'image storage_path is required';
          end if;
          v_image_type := coalesce(v_image ->> 'image_type', 'customer');
          if not (v_image_type = any(v_allowed_image_types)) then
            raise exception 'invalid image_type';
          end if;

          insert into public.card_images (card_id, image_type, storage_path)
          values (
            v_card_id,
            v_image_type,
            trim(v_image ->> 'storage_path')
          );
        end loop;
      end if;
    end loop;

    delete from public.cards c
    where c.order_id = p_order_id
      and not (c.id = any (v_kept_card_ids));
  end if;

  select * into v_order from public.orders where id = p_order_id;

  return jsonb_build_object(
    'id', v_order.id,
    'display_id', v_order.display_id,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'general_notes', v_order.general_notes,
    'photos_drive_url', v_order.photos_drive_url,
    'status', v_order.status,
    'pending_kind', v_order.pending_kind,
    'completed_at', v_order.completed_at,
    'quote_bulk_counts', v_order.quote_bulk_counts,
    'quote_override_label', v_order.quote_override_label,
    'quote_override_amount', v_order.quote_override_amount,
    'is_priority', v_order.is_priority
  );
end;
$$;


ALTER FUNCTION "public"."update_order"("p_order_id" "uuid", "p_order" "jsonb", "p_contacts" "jsonb", "p_cards" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_lookup_log" (
    "id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "looked_up_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."account_lookup_log" OWNER TO "postgres";


ALTER TABLE "public"."account_lookup_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."account_lookup_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."account_signup_notice_log" (
    "id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."account_signup_notice_log" OWNER TO "postgres";


ALTER TABLE "public"."account_signup_notice_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."account_signup_notice_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admin_sessions" (
    "token" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."admin_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."card_images" (
    "id" bigint NOT NULL,
    "card_id" "uuid" NOT NULL,
    "image_type" "text" DEFAULT 'customer'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    CONSTRAINT "card_images_image_type_check" CHECK (("image_type" = ANY (ARRAY['customer'::"text", 'admin'::"text", 'progress_front'::"text", 'progress_back'::"text", 'final_front'::"text", 'final_back'::"text"])))
);


ALTER TABLE "public"."card_images" OWNER TO "postgres";


ALTER TABLE "public"."card_images" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."card_images_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."card_images_original" (
    "id" bigint NOT NULL,
    "card_id" "uuid" NOT NULL,
    "image_type" "text" DEFAULT 'customer'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    CONSTRAINT "card_images_original_image_type_check" CHECK (("image_type" = ANY (ARRAY['customer'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."card_images_original" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cards" (
    "id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "card_name" "text" NOT NULL,
    "set_name" "text",
    "description" "text",
    "market_value_raw_nm" numeric(10,2),
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "sort_order" integer NOT NULL,
    "admin_note" "text",
    "checklist" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "cards_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'in_progress'::"text", 'completed'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cards_original" (
    "id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "card_name" "text" NOT NULL,
    "set_name" "text",
    "description" "text"
);


ALTER TABLE "public"."cards_original" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" bigint NOT NULL,
    "order_id" "uuid" NOT NULL,
    "contact_type" "text" NOT NULL,
    "value" "text" NOT NULL,
    CONSTRAINT "contacts_contact_type_check" CHECK (("contact_type" = ANY (ARRAY['phone'::"text", 'discord'::"text", 'instagram'::"text"])))
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


ALTER TABLE "public"."contacts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."contacts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."contacts_original" (
    "id" bigint NOT NULL,
    "order_id" "uuid" NOT NULL,
    "contact_type" "text" NOT NULL,
    "value" "text" NOT NULL,
    CONSTRAINT "contacts_original_contact_type_check" CHECK (("contact_type" = ANY (ARRAY['phone'::"text", 'discord'::"text", 'instagram'::"text"])))
);


ALTER TABLE "public"."contacts_original" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_email" "text" NOT NULL,
    "user_id" "uuid",
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "email_error" "text",
    "read_at" timestamp with time zone,
    "batch_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "changelog" "jsonb",
    CONSTRAINT "customer_messages_email_status_check" CHECK (("email_status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."customer_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_profiles" (
    "user_id" "uuid" NOT NULL,
    "full_name" "text",
    "contacts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "last_name" "text"
);


ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gallery_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    "set_name" "text" DEFAULT ''::"text" NOT NULL,
    "damage_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "thumbnail_path" "text",
    "tcg_lookup_title" "text",
    "tcg_lookup_set_name" "text",
    "tcg_card_id" "text",
    "card_number" "text"
);


ALTER TABLE "public"."gallery_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."gallery_items"."thumbnail_path" IS 'Storage path in gallery bucket for the full-card preview image.';



COMMENT ON COLUMN "public"."gallery_items"."tcg_lookup_title" IS 'Optional admin-only card name for Pokémon TCG API thumbnail lookup; falls back to title.';



COMMENT ON COLUMN "public"."gallery_items"."tcg_lookup_set_name" IS 'Optional admin-only set name for Pokémon TCG API thumbnail lookup; falls back to set_name.';



COMMENT ON COLUMN "public"."gallery_items"."tcg_card_id" IS 'Pokémon TCG API card id; when set, thumbnail generation uses this exact card.';



COMMENT ON COLUMN "public"."gallery_items"."card_number" IS 'Official Pokémon TCG collector number (e.g. 277/297), set when admin locks in a card from API search.';



CREATE TABLE IF NOT EXISTS "public"."gallery_pairs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "media_kind" "text" DEFAULT 'image'::"text" NOT NULL,
    "before_path" "text",
    "after_path" "text",
    "caption" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "gallery_pairs_media_kind_check" CHECK (("media_kind" = ANY (ARRAY['image'::"text", 'video'::"text"])))
);


ALTER TABLE "public"."gallery_pairs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_quote_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "card_name" "text" NOT NULL,
    "set_name" "text",
    "service_key" "text" NOT NULL,
    "service_label" "text" NOT NULL,
    "quote_base_amount" numeric(10,2) NOT NULL,
    "high_value_surcharge" numeric(10,2)
);


ALTER TABLE "public"."order_quote_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" NOT NULL,
    "display_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_name" "text" NOT NULL,
    "delivery_method" "text" NOT NULL,
    "general_notes" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "user_id" "uuid",
    "customer_email" "text",
    "preferred_contact_type" "text",
    "preferred_contact_value" "text",
    "completed_at" timestamp with time zone,
    "status_changed_at" timestamp with time zone DEFAULT "now"(),
    "quote_bulk_counts" "jsonb",
    "quote_override_label" "text",
    "quote_override_amount" numeric(10,2),
    "updates_available_at" timestamp with time zone,
    "customer_updates_seen_at" timestamp with time zone,
    "queue_priority" integer,
    "photos_drive_url" "text",
    "pending_kind" "text",
    "heard_about_source" "text",
    "first_name" "text",
    "last_name" "text",
    "is_priority" boolean DEFAULT false NOT NULL,
    CONSTRAINT "orders_delivery_method_check" CHECK (("delivery_method" = ANY (ARRAY['local_dropoff'::"text", 'shipping'::"text"]))),
    CONSTRAINT "orders_pending_kind_check" CHECK ((("pending_kind" IS NULL) OR ("pending_kind" = ANY (ARRAY['quote'::"text", 'drop_off'::"text"])))),
    CONSTRAINT "orders_pending_kind_for_status_check" CHECK (((("status" = 'pending'::"text") AND ("pending_kind" IS NOT NULL)) OR (("status" IS DISTINCT FROM 'pending'::"text") AND ("pending_kind" IS NULL)))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'pending'::"text", 'in_progress'::"text", 'ready'::"text", 'completed'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."queue_priority" IS 'Deprecated: manual admin reorder removed. NULL for all orders; queue uses is_priority then created_at.';



COMMENT ON COLUMN "public"."orders"."is_priority" IS 'Paid priority service — whole order jumps ahead in the To do queue.';



ALTER TABLE "public"."orders" ALTER COLUMN "display_id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."orders_display_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."orders_original" (
    "id" "uuid" NOT NULL,
    "display_id" bigint NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "customer_name" "text" NOT NULL,
    "delivery_method" "text" NOT NULL,
    "general_notes" "text",
    "first_name" "text",
    "last_name" "text",
    CONSTRAINT "orders_original_delivery_method_check" CHECK (("delivery_method" = ANY (ARRAY['local_dropoff'::"text", 'shipping'::"text"])))
);


ALTER TABLE "public"."orders_original" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quote_requests" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivery_method" "text" NOT NULL,
    "restoration_details" "text" NOT NULL,
    "contact" "text" NOT NULL,
    "image_paths" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "quote_requests_delivery_method_check" CHECK (("delivery_method" = ANY (ARRAY['local_dropoff'::"text", 'shipping'::"text"])))
);


ALTER TABLE "public"."quote_requests" OWNER TO "postgres";


ALTER TABLE "public"."quote_requests" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."quote_requests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."account_lookup_log"
    ADD CONSTRAINT "account_lookup_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_signup_notice_log"
    ADD CONSTRAINT "account_signup_notice_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("token");



ALTER TABLE ONLY "public"."card_images_original"
    ADD CONSTRAINT "card_images_original_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_images"
    ADD CONSTRAINT "card_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cards_original"
    ADD CONSTRAINT "cards_original_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts_original"
    ADD CONSTRAINT "contacts_original_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_messages"
    ADD CONSTRAINT "customer_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."gallery_items"
    ADD CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gallery_pairs"
    ADD CONSTRAINT "gallery_pairs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_quote_items"
    ADD CONSTRAINT "order_quote_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders_original"
    ADD CONSTRAINT "orders_original_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quote_requests"
    ADD CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id");



CREATE INDEX "account_lookup_log_email_looked_up_at_idx" ON "public"."account_lookup_log" USING "btree" ("email", "looked_up_at" DESC);



CREATE INDEX "account_lookup_log_looked_up_at_idx" ON "public"."account_lookup_log" USING "btree" ("looked_up_at");



CREATE INDEX "account_signup_notice_log_email_sent_at_idx" ON "public"."account_signup_notice_log" USING "btree" ("email", "sent_at" DESC);



CREATE INDEX "card_images_card_id_idx" ON "public"."card_images" USING "btree" ("card_id");



CREATE INDEX "card_images_original_card_id_idx" ON "public"."card_images_original" USING "btree" ("card_id");



CREATE INDEX "cards_order_id_idx" ON "public"."cards" USING "btree" ("order_id");



CREATE INDEX "cards_order_id_sort_order_idx" ON "public"."cards" USING "btree" ("order_id", "sort_order");



CREATE INDEX "cards_original_order_id_idx" ON "public"."cards_original" USING "btree" ("order_id");



CREATE INDEX "contacts_order_id_idx" ON "public"."contacts" USING "btree" ("order_id");



CREATE INDEX "contacts_original_order_id_idx" ON "public"."contacts_original" USING "btree" ("order_id");



CREATE INDEX "customer_messages_batch_id_idx" ON "public"."customer_messages" USING "btree" ("batch_id");



CREATE INDEX "customer_messages_order_id_sent_at_idx" ON "public"."customer_messages" USING "btree" ("order_id", "sent_at" DESC);



CREATE INDEX "customer_messages_recipient_email_sent_at_idx" ON "public"."customer_messages" USING "btree" ("recipient_email", "sent_at" DESC);



CREATE INDEX "customer_messages_user_id_sent_at_idx" ON "public"."customer_messages" USING "btree" ("user_id", "sent_at" DESC);



CREATE INDEX "gallery_items_published_created_at_idx" ON "public"."gallery_items" USING "btree" ("published", "created_at" DESC);



CREATE INDEX "gallery_items_published_idx" ON "public"."gallery_items" USING "btree" ("published");



CREATE INDEX "gallery_pairs_item_id_idx" ON "public"."gallery_pairs" USING "btree" ("item_id", "sort_order");



CREATE INDEX "order_quote_items_order_id_idx" ON "public"."order_quote_items" USING "btree" ("order_id", "sort_order");



CREATE INDEX "orders_completed_at_idx" ON "public"."orders" USING "btree" ("completed_at") WHERE ("completed_at" IS NOT NULL);



CREATE INDEX "orders_customer_email_idx" ON "public"."orders" USING "btree" ("lower"("customer_email"));



CREATE INDEX "orders_status_idx" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "orders_status_queue_priority_idx" ON "public"."orders" USING "btree" ("status", "queue_priority");



CREATE INDEX "orders_user_id_idx" ON "public"."orders" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "cards_assign_sort_order_trg" BEFORE INSERT ON "public"."cards" FOR EACH ROW EXECUTE FUNCTION "public"."cards_assign_sort_order"();



CREATE OR REPLACE TRIGGER "customer_messages_restrict_customer_update" BEFORE UPDATE ON "public"."customer_messages" FOR EACH ROW EXECUTE FUNCTION "public"."customer_messages_restrict_customer_update"();



CREATE OR REPLACE TRIGGER "notify-discord-n-google-sheets" AFTER INSERT ON "public"."quote_requests" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://tmdbqymvjphhfvgyimnb.supabase.co/functions/v1/notify', 'POST', '{"Content-type":"application/json"}', '{}', '5000');



CREATE OR REPLACE TRIGGER "orders-insert-notify" AFTER INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://tmdbqymvjphhfvgyimnb.supabase.co/functions/v1/notify', 'POST', '{"Content-type":"application/json"}', '{}', '5000');



CREATE OR REPLACE TRIGGER "orders_status_changed_at_trg" BEFORE INSERT OR UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."orders_touch_status_changed_at"();



ALTER TABLE ONLY "public"."card_images"
    ADD CONSTRAINT "card_images_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."card_images_original"
    ADD CONSTRAINT "card_images_original_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."cards_original"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cards_original"
    ADD CONSTRAINT "cards_original_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders_original"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts_original"
    ADD CONSTRAINT "contacts_original_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders_original"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_messages"
    ADD CONSTRAINT "customer_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_messages"
    ADD CONSTRAINT "customer_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gallery_pairs"
    ADD CONSTRAINT "gallery_pairs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."gallery_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_quote_items"
    ADD CONSTRAINT "order_quote_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE "public"."account_lookup_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_signup_notice_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon can insert quote requests" ON "public"."quote_requests" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "anon can read pairs for published gallery items" ON "public"."gallery_pairs" FOR SELECT TO "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."gallery_items" "gi"
  WHERE (("gi"."id" = "gallery_pairs"."item_id") AND ("gi"."published" = true)))));



CREATE POLICY "anon can read published gallery items" ON "public"."gallery_items" FOR SELECT TO "anon" USING (("published" = true));



CREATE POLICY "authenticated can read pairs for published gallery items" ON "public"."gallery_pairs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."gallery_items" "gi"
  WHERE (("gi"."id" = "gallery_pairs"."item_id") AND ("gi"."published" = true)))));



CREATE POLICY "authenticated can read published gallery items" ON "public"."gallery_items" FOR SELECT TO "authenticated" USING (("published" = true));



ALTER TABLE "public"."card_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_images_original" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cards_original" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts_original" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gallery_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gallery_pairs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_quote_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders_original" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quote_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users can insert their own profile" ON "public"."customer_profiles" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "users can mark their messages read" ON "public"."customer_messages" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "customer_messages"."order_id") AND ("o"."user_id" = "auth"."uid"())))))) WITH CHECK ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "customer_messages"."order_id") AND ("o"."user_id" = "auth"."uid"()))))));



CREATE POLICY "users can read their own messages" ON "public"."customer_messages" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "customer_messages"."order_id") AND ("o"."user_id" = "auth"."uid"()))))));



CREATE POLICY "users can read their own profile" ON "public"."customer_profiles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "users can update their own profile" ON "public"."customer_profiles" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "users can view cards for their orders" ON "public"."cards" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders"
  WHERE (("orders"."id" = "cards"."order_id") AND ("orders"."user_id" = "auth"."uid"())))));



CREATE POLICY "users can view contacts for their orders" ON "public"."contacts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders"
  WHERE (("orders"."id" = "contacts"."order_id") AND ("orders"."user_id" = "auth"."uid"())))));



CREATE POLICY "users can view images for their orders" ON "public"."card_images" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."cards"
     JOIN "public"."orders" ON (("orders"."id" = "cards"."order_id")))
  WHERE (("cards"."id" = "card_images"."card_id") AND ("orders"."user_id" = "auth"."uid"())))));



CREATE POLICY "users can view their own orders" ON "public"."orders" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."cards_assign_sort_order"() TO "anon";
GRANT ALL ON FUNCTION "public"."cards_assign_sort_order"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cards_assign_sort_order"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_my_orders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_my_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_my_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_my_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_order"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_order"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."customer_messages_restrict_customer_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."customer_messages_restrict_customer_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."customer_messages_restrict_customer_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."email_has_account"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."email_has_account"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."email_has_account"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."email_has_account"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_order"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_order"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_order"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_order"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_orders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_unread_message_count"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_unread_message_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_unread_message_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_unread_message_count"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_queue_card_count"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_queue_card_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_queue_card_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_queue_card_count"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_queue_orders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_queue_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_queue_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_queue_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_my_messages_read"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_my_messages_read"("p_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."mark_my_messages_read"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_my_messages_read"("p_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."move_order_in_status"("p_order_id" "uuid", "p_status" "text", "p_queue_index" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."move_order_in_status"("p_order_id" "uuid", "p_status" "text", "p_queue_index" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."move_order_in_status"("p_order_id" "uuid", "p_status" "text", "p_queue_index" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_order_in_status"("p_order_id" "uuid", "p_status" "text", "p_queue_index" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."orders_set_queue_priority"() TO "anon";
GRANT ALL ON FUNCTION "public"."orders_set_queue_priority"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."orders_set_queue_priority"() TO "service_role";



GRANT ALL ON FUNCTION "public"."orders_touch_status_changed_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."orders_touch_status_changed_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."orders_touch_status_changed_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorder_queue_orders"("p_ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_queue_orders"("p_ordered_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_queue_orders"("p_ordered_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_queue_orders"("p_ordered_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorder_status_orders"("p_status" "text", "p_ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_status_orders"("p_status" "text", "p_ordered_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_status_orders"("p_status" "text", "p_ordered_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_status_orders"("p_status" "text", "p_ordered_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_profile_name_from_latest_order"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_profile_name_from_latest_order"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_profile_name_from_latest_order"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_profile_name_from_latest_order"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_order"("p_order_id" "uuid", "p_order" "jsonb", "p_contacts" "jsonb", "p_cards" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_order"("p_order_id" "uuid", "p_order" "jsonb", "p_contacts" "jsonb", "p_cards" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_order"("p_order_id" "uuid", "p_order" "jsonb", "p_contacts" "jsonb", "p_cards" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_order"("p_order_id" "uuid", "p_order" "jsonb", "p_contacts" "jsonb", "p_cards" "jsonb") TO "service_role";


















GRANT ALL ON TABLE "public"."account_lookup_log" TO "anon";
GRANT ALL ON TABLE "public"."account_lookup_log" TO "authenticated";
GRANT ALL ON TABLE "public"."account_lookup_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."account_lookup_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."account_lookup_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."account_lookup_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."account_signup_notice_log" TO "anon";
GRANT ALL ON TABLE "public"."account_signup_notice_log" TO "authenticated";
GRANT ALL ON TABLE "public"."account_signup_notice_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."account_signup_notice_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."account_signup_notice_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."account_signup_notice_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_sessions" TO "anon";
GRANT ALL ON TABLE "public"."admin_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."card_images" TO "anon";
GRANT ALL ON TABLE "public"."card_images" TO "authenticated";
GRANT ALL ON TABLE "public"."card_images" TO "service_role";



GRANT ALL ON SEQUENCE "public"."card_images_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."card_images_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."card_images_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."card_images_original" TO "anon";
GRANT ALL ON TABLE "public"."card_images_original" TO "authenticated";
GRANT ALL ON TABLE "public"."card_images_original" TO "service_role";



GRANT ALL ON TABLE "public"."cards" TO "anon";
GRANT ALL ON TABLE "public"."cards" TO "authenticated";
GRANT ALL ON TABLE "public"."cards" TO "service_role";



GRANT ALL ON TABLE "public"."cards_original" TO "anon";
GRANT ALL ON TABLE "public"."cards_original" TO "authenticated";
GRANT ALL ON TABLE "public"."cards_original" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."contacts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."contacts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."contacts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."contacts_original" TO "anon";
GRANT ALL ON TABLE "public"."contacts_original" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts_original" TO "service_role";



GRANT ALL ON TABLE "public"."customer_messages" TO "anon";
GRANT ALL ON TABLE "public"."customer_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_messages" TO "service_role";



GRANT ALL ON TABLE "public"."customer_profiles" TO "anon";
GRANT ALL ON TABLE "public"."customer_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."gallery_items" TO "anon";
GRANT ALL ON TABLE "public"."gallery_items" TO "authenticated";
GRANT ALL ON TABLE "public"."gallery_items" TO "service_role";



GRANT ALL ON TABLE "public"."gallery_pairs" TO "anon";
GRANT ALL ON TABLE "public"."gallery_pairs" TO "authenticated";
GRANT ALL ON TABLE "public"."gallery_pairs" TO "service_role";



GRANT ALL ON TABLE "public"."order_quote_items" TO "anon";
GRANT ALL ON TABLE "public"."order_quote_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_quote_items" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."orders_display_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_display_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_display_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders_original" TO "anon";
GRANT ALL ON TABLE "public"."orders_original" TO "authenticated";
GRANT ALL ON TABLE "public"."orders_original" TO "service_role";



GRANT ALL ON TABLE "public"."quote_requests" TO "anon";
GRANT ALL ON TABLE "public"."quote_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."quote_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."quote_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quote_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quote_requests_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































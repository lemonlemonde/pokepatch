-- PokePatch: customer messages (admin → customer broadcasts)
--
-- SAFETY CONTRACT (read before applying)
-- - Additive only: creates NEW table / indexes / policies / functions / trigger.
-- - Does NOT touch orders, cards, contacts, gallery_*, quote_*, customer_profiles,
--   admin_sessions, storage, or any *_original tables.
-- - No DROP TABLE, TRUNCATE, DELETE, or UPDATE of existing row data.
-- - No ALTER TABLE on any pre-existing table.
-- - FK on user_id uses ON DELETE SET NULL (never CASCADE) so deleting an auth
--   user cannot wipe message rows — it only clears user_id.
-- - Wrapped in a transaction: any error rolls the whole migration back.
-- - If public.customer_messages already exists with an unexpected shape, this
--   script RAISES and aborts instead of altering it.
-- - CREATE OR REPLACE on helper functions only runs when the function is absent
--   or already references customer_messages (ours / prior apply of this file).
--
-- Apply manually.

begin;

-- ---------------------------------------------------------------------------
-- Preflight: refuse if a conflicting object already exists in an unexpected form
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  missing text;
begin
  if to_regclass('public.customer_messages') is not null then
    select string_agg(required.col, ', ' order by required.col)
      into missing
    from (
      values
        ('id'),
        ('recipient_email'),
        ('user_id'),
        ('subject'),
        ('body'),
        ('sent_at'),
        ('email_status'),
        ('email_error'),
        ('read_at'),
        ('batch_id')
    ) as required(col)
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = 'customer_messages'
     and c.column_name = required.col
    where c.column_name is null;

    if missing is not null then
      raise exception
        'Refusing to apply: public.customer_messages exists but is missing column(s): %. Not altering existing table.',
        missing;
    end if;
  end if;

  select pg_get_functiondef(p.oid)
    into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_my_unread_message_count'
    and pg_get_function_identity_arguments(p.oid) = '';
  if src is not null and position('customer_messages' in src) = 0 then
    raise exception
      'Refusing to replace public.get_my_unread_message_count(): existing definition is unrelated.';
  end if;

  select pg_get_functiondef(p.oid)
    into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'mark_my_messages_read'
    and pg_get_function_identity_arguments(p.oid) = 'p_ids uuid[]';
  if src is not null and position('customer_messages' in src) = 0 then
    raise exception
      'Refusing to replace public.mark_my_messages_read(uuid[]): existing definition is unrelated.';
  end if;

  select pg_get_functiondef(p.oid)
    into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'customer_messages_restrict_customer_update'
    and pg_get_function_identity_arguments(p.oid) = '';
  if src is not null and position('customer may only update read_at' in src) = 0
     and position('customers may only update read_at' in src) = 0 then
    raise exception
      'Refusing to replace public.customer_messages_restrict_customer_update(): existing definition is unrelated.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- New table (no-op if already created by a prior successful apply)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  user_id uuid references auth.users (id) on delete set null,
  subject text not null,
  body text not null,
  sent_at timestamptz not null default now(),
  email_status text not null default 'pending'
    check (email_status = any (array['pending'::text, 'sent'::text, 'failed'::text])),
  email_error text,
  read_at timestamptz,
  batch_id uuid not null
);

create index if not exists customer_messages_user_id_sent_at_idx
  on public.customer_messages (user_id, sent_at desc);

create index if not exists customer_messages_recipient_email_sent_at_idx
  on public.customer_messages (recipient_email, sent_at desc);

create index if not exists customer_messages_batch_id_idx
  on public.customer_messages (batch_id);

alter table public.customer_messages enable row level security;

-- Policies: drop/recreate only these named policies on the new table (no data).
drop policy if exists "users can read their own messages" on public.customer_messages;
create policy "users can read their own messages"
  on public.customer_messages for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users can mark their messages read" on public.customer_messages;
create policy "users can mark their messages read"
  on public.customer_messages for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Trigger function: customers may only change read_at via direct UPDATE.
create or replace function public.customer_messages_restrict_customer_update()
returns trigger
language plpgsql
as $$
begin
  -- customer_messages guard: customers may only update read_at
  if auth.role() = 'authenticated' then
    if new.id is distinct from old.id
      or new.recipient_email is distinct from old.recipient_email
      or new.user_id is distinct from old.user_id
      or new.subject is distinct from old.subject
      or new.body is distinct from old.body
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

drop trigger if exists customer_messages_restrict_customer_update
  on public.customer_messages;
create trigger customer_messages_restrict_customer_update
  before update on public.customer_messages
  for each row
  execute function public.customer_messages_restrict_customer_update();

grant select, update on public.customer_messages to authenticated;

-- Unread count for navbar badge (reads own rows only via auth.uid()).
create or replace function public.get_my_unread_message_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  -- customer_messages
  select count(*)::bigint
  from public.customer_messages
  where user_id = auth.uid()
    and read_at is null;
$$;

revoke all on function public.get_my_unread_message_count() from public;
grant execute on function public.get_my_unread_message_count() to authenticated;

-- Mark own unread messages read (only sets read_at; scoped to auth.uid()).
create or replace function public.mark_my_messages_read(p_ids uuid[] default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count bigint;
begin
  -- customer_messages
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.customer_messages
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null
    and (p_ids is null or id = any (p_ids));

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_my_messages_read(uuid[]) from public;
grant execute on function public.mark_my_messages_read(uuid[]) to authenticated;

commit;

-- Link every customer_messages row to an order (required going forward).

-- 1) Add nullable FK first so we can backfill / purge orphans.
alter table public.customer_messages
  add column if not exists order_id uuid references public.orders (id) on delete cascade;
-- 2) Backfill from "Regarding Order #<display_id>" when that order still exists.
update public.customer_messages cm
set order_id = o.id
from public.orders o
where cm.order_id is null
  and cm.body ~* '^Regarding Order #[0-9]+'
  and o.display_id = (
    substring(cm.body from '(?i)^Regarding Order #([0-9]+)')
  )::bigint;
-- 3) Drop leftover broadcast rows that cannot be linked (test / general emails).
delete from public.customer_messages
where order_id is null;
-- 4) Require order_id for all future rows.
alter table public.customer_messages
  alter column order_id set not null;
create index if not exists customer_messages_order_id_sent_at_idx
  on public.customer_messages (order_id, sent_at desc);
-- 5) Customers may read messages for orders they own, not only via user_id.
drop policy if exists "users can read their own messages" on public.customer_messages;
create policy "users can read their own messages"
  on public.customer_messages for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
    )
  );
drop policy if exists "users can mark their messages read" on public.customer_messages;
create policy "users can mark their messages read"
  on public.customer_messages for update
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1
      from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
    )
  );
-- 6) Customers may only change read_at (include order_id in the guard).
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
      or new.order_id is distinct from old.order_id
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

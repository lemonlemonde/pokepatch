-- Persist structured order-edit diffs on customer messages (when present).
alter table public.customer_messages
  add column if not exists changelog jsonb null;

-- Customers may only change read_at (changelog is admin/system-owned).
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

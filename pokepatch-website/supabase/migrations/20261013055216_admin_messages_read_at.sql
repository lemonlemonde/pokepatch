-- Track whether admin has seen customer→admin messages.
-- customer_messages.read_at remains customer-side (admin→customer unread).

alter table public.customer_messages
  add column if not exists admin_read_at timestamptz;

comment on column public.customer_messages.admin_read_at is
  'When admin viewed this customer message; null means unread in admin Messages inbox.';

-- Existing history: treat as already seen so the inbox only shows new mail after ship.
update public.customer_messages
set admin_read_at = coalesce(sent_at, now())
where admin_read_at is null;

create index if not exists customer_messages_admin_unread_idx
  on public.customer_messages (order_id, sent_at desc)
  where sender = 'customer' and admin_read_at is null;

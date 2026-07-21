-- Count / mark-read should include messages for orders the customer owns,
-- not only rows where user_id was set at send time.

create or replace function public.get_my_unread_message_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
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

create or replace function public.mark_my_messages_read(p_ids uuid[] default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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

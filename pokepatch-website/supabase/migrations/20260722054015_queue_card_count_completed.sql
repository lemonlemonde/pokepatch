-- Home marketing counts: add all-time completed cards to get_queue_card_count.
-- Additive: CREATE OR REPLACE only; grants unchanged.

create or replace function public.get_queue_card_count()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'todo',
    (
      select count(*)::integer
      from public.cards c
      where c.status = 'todo'
    ),
    'in_progress',
    (
      select count(*)::integer
      from public.cards c
      where c.status = 'in_progress'
    ),
    'completed',
    (
      select count(*)::integer
      from public.cards c
      where c.status = 'completed'
    )
  );
$$;

revoke all on function public.get_queue_card_count() from public;
grant execute on function public.get_queue_card_count() to anon;
grant execute on function public.get_queue_card_count() to authenticated;

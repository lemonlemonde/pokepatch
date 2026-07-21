-- Public home counts: separate todo vs in_progress cards by cards.status.
-- Additive: CREATE OR REPLACE of get_queue_card_count only; grants unchanged.

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
    )
  );
$$;

revoke all on function public.get_queue_card_count() from public;
grant execute on function public.get_queue_card_count() to anon;
grant execute on function public.get_queue_card_count() to authenticated;

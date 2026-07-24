-- Stable card order independent of UUID ordering.
alter table public.cards
  add column if not exists sort_order integer;

-- Preserve current display order (historically by card id).
with ranked as (
  select
    c.id as card_id,
    row_number() over (
      partition by c.order_id
      order by c.id
    ) - 1 as sort_order
  from public.cards c
)
update public.cards c
set sort_order = ranked.sort_order
from ranked
where c.id = ranked.card_id
  and c.sort_order is null;

alter table public.cards
  alter column sort_order set default null;

-- create_order (and any insert that omits sort_order) get next index per order.
create or replace function public.cards_assign_sort_order()
returns trigger
language plpgsql
as $$
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

drop trigger if exists cards_assign_sort_order_trg on public.cards;
create trigger cards_assign_sort_order_trg
  before insert on public.cards
  for each row
  execute function public.cards_assign_sort_order();

alter table public.cards
  alter column sort_order set not null;

create index if not exists cards_order_id_sort_order_idx
  on public.cards (order_id, sort_order);

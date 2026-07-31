-- Stable Pokémon TCG API card id for thumbnail fetch (e.g. me2pt5-277, sm2-140).

alter table public.gallery_items
  add column if not exists tcg_card_id text;
comment on column public.gallery_items.tcg_card_id is
  'Pokémon TCG API card id; when set, thumbnail generation uses this exact card.';
-- Pin known gallery items to the correct API card (not ambiguous search results).

update public.gallery_items
set tcg_card_id = 'me2pt5-277'
where id = 'afefd0c7-761f-40f8-93cb-182f85a8238c';
update public.gallery_items
set tcg_card_id = 'ex10-108'
where id = '89871a49-faa2-4d70-bdd9-5ae05cac8d9a';
update public.gallery_items
set tcg_card_id = 'bw1-113'
where id = '9533a256-25b7-4913-b8d2-f020384011c0';
update public.gallery_items
set tcg_card_id = 'sm2-140'
where id = '60bd3a1a-8c38-4371-b552-267af941c4d1';
update public.gallery_items
set tcg_card_id = 'xyp-XY124'
where id = '79de1974-8972-4669-994b-c12c1853a0b7';

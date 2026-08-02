-- Official collector number from Pokémon TCG API (locked in with card search).
alter table public.gallery_items
  add column if not exists card_number text;

comment on column public.gallery_items.card_number is
  'Official Pokémon TCG collector number (e.g. 277/297), set when admin locks in a card from API search.';

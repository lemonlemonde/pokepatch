-- Admin-only Pokémon TCG API lookup fields (separate from customer-facing title/set_name).

alter table public.gallery_items
  add column if not exists tcg_lookup_title text,
  add column if not exists tcg_lookup_set_name text;
comment on column public.gallery_items.tcg_lookup_title is
  'Optional admin-only card name for Pokémon TCG API thumbnail lookup; falls back to title.';
comment on column public.gallery_items.tcg_lookup_set_name is
  'Optional admin-only set name for Pokémon TCG API thumbnail lookup; falls back to set_name.';
-- Seed lookup fields from current canonical set names, then restore informal display set names.

update public.gallery_items
set
  tcg_lookup_set_name = set_name,
  tcg_lookup_title = case title
    when 'Pikachu EX' then 'Pikachu-EX'
    when 'Rayquaza' then 'Rayquaza δ'
    when 'Reshiram Full Art' then 'Reshiram'
    else regexp_replace(title, '\s*\([^)]*\)', '', 'g')
  end
where tcg_lookup_set_name is null;
update public.gallery_items
set set_name = 'XY Promos'
where set_name = 'XY Black Star Promos';
update public.gallery_items
set set_name = 'Delta Species'
where set_name = 'EX Delta Species';
update public.gallery_items
set set_name = 'Unseen Forces'
where set_name = 'EX Unseen Forces';
update public.gallery_items
set set_name = 'Black and White'
where set_name = 'Black & White';
update public.gallery_items
set set_name = 'Crown Zenith: Galarian Gallery'
where set_name = 'Crown Zenith Galarian Gallery';

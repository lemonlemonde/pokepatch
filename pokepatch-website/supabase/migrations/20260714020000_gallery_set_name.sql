-- PokePatch: gallery item set name
-- Additive only.

begin;

alter table public.gallery_items
  add column if not exists set_name text not null default '';

commit;

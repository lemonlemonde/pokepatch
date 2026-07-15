-- PokePatch: per-pair captions for gallery before/after pairs.
--
-- SAFETY: additive only. Adds an optional caption shown on /gallery.

begin;

alter table public.gallery_pairs
  add column if not exists caption text not null default '';

commit;

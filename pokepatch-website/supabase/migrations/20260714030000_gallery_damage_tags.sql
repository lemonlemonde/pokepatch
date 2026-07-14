-- PokePatch: gallery damage tags checklist
-- Additive. Keeps description column (unused by UI).

begin;

alter table public.gallery_items
  add column if not exists damage_tags text[] not null default '{}';

-- Backfill from existing free-text descriptions (best-effort).
update public.gallery_items
set damage_tags = array['crease', 'scratching']
where title ilike '%mewtwo%'
  and cardinality(damage_tags) = 0;

update public.gallery_items
set damage_tags = array['edge_lift', 'crease']
where title ilike '%scizor%'
  and cardinality(damage_tags) = 0;

update public.gallery_items
set damage_tags = array['edge_lift', 'dirt']
where title ilike '%reshiram%'
  and cardinality(damage_tags) = 0;

update public.gallery_items
set damage_tags = array['crease']
where title ilike '%rayquaza%'
  and cardinality(damage_tags) = 0;

update public.gallery_items
set damage_tags = array['dent']
where title ilike '%pikachu%'
  and cardinality(damage_tags) = 0;

commit;

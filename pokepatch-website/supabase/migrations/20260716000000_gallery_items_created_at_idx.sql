-- Gallery cards are ordered by created_at (newest first).
-- Index supports the public query: published = true ORDER BY created_at DESC.
-- Replaces the old (sort_order, created_at) index dropped in 20260714040000.

begin;

create index if not exists gallery_items_published_created_at_idx
  on public.gallery_items (published, created_at desc);

commit;

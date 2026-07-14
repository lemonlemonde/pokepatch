-- Gallery cards are ordered by created_at (newest first).
-- Manual item sort_order is unused — drop it.
-- Pairs still use sort_order within each card (featured pair, etc.).

begin;

drop index if exists public.gallery_items_sort_order_idx;

alter table public.gallery_items
  drop column if exists sort_order;

commit;

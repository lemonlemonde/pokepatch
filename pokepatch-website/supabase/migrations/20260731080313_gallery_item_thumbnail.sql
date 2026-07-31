-- Full-card thumbnail for gallery items (shown on /gallery cards; managed in admin).
alter table public.gallery_items
  add column if not exists thumbnail_path text;
comment on column public.gallery_items.thumbnail_path is
  'Storage path in gallery bucket for the full-card preview image.';

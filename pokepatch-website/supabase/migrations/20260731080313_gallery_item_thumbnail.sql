-- Small card icon for gallery items (shown beside title on /gallery; managed in admin).
alter table public.gallery_items
  add column if not exists thumbnail_path text;

comment on column public.gallery_items.thumbnail_path is
  'Storage path in gallery bucket for the small card icon image.';

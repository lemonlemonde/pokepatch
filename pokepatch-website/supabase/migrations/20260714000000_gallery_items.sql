-- PokePatch: public gallery items (CMS via /admin/)
--
-- SAFETY: additive only. Does not touch quote_requests, orders, or card-photos.
-- Run manually in Supabase SQL Editor when ready.

begin;

-- ---------------------------------------------------------------------------
-- gallery_items
-- ---------------------------------------------------------------------------

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  description text not null default '',
  sort_order integer not null default 0,
  paired_video_layout boolean not null default false,
  published boolean not null default true,
  before_front text,
  after_front text,
  before_back text,
  after_back text,
  before_front_video text,
  after_front_video text,
  before_back_video text,
  after_back_video text
);

create index if not exists gallery_items_sort_order_idx
  on public.gallery_items (sort_order, created_at);

create index if not exists gallery_items_published_idx
  on public.gallery_items (published);

alter table public.gallery_items enable row level security;

-- Public gallery page reads published rows with the anon key.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'gallery_items'
      and policyname = 'anon can read published gallery items'
  ) then
    create policy "anon can read published gallery items"
      on public.gallery_items
      for select
      to anon
      using (published = true);
  end if;
end;
$$;

-- Service role (admin-api) bypasses RLS for writes.

-- ---------------------------------------------------------------------------
-- Storage bucket: gallery (public marketing media)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do nothing;

-- Public read for gallery objects (marketing assets).
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'public can read gallery objects'
  ) then
    create policy "public can read gallery objects"
      on storage.objects
      for select
      to public
      using (bucket_id = 'gallery');
  end if;
end;
$$;

-- No anon insert/update/delete on gallery storage — uploads go through admin-api
-- (service role).

commit;

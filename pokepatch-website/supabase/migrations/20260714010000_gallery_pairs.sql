-- PokePatch: gallery before/after pairs (replace fixed front/back columns)
--
-- SAFETY: migrates existing slot columns into gallery_pairs, then drops them.
-- Run in Supabase SQL Editor after 20260714000000_gallery_items.sql.

begin;

-- ---------------------------------------------------------------------------
-- gallery_pairs
-- ---------------------------------------------------------------------------

create table if not exists public.gallery_pairs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  item_id uuid not null references public.gallery_items (id) on delete cascade,
  sort_order integer not null default 0,
  media_kind text not null default 'image'
    check (media_kind in ('image', 'video')),
  before_path text,
  after_path text
);

create index if not exists gallery_pairs_item_id_idx
  on public.gallery_pairs (item_id, sort_order);

alter table public.gallery_pairs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'gallery_pairs'
      and policyname = 'anon can read pairs for published gallery items'
  ) then
    create policy "anon can read pairs for published gallery items"
      on public.gallery_pairs
      for select
      to anon
      using (
        exists (
          select 1
          from public.gallery_items gi
          where gi.id = gallery_pairs.item_id
            and gi.published = true
        )
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Migrate legacy slot columns → pairs (idempotent if pairs already exist)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  has_slots boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'gallery_items'
      and column_name = 'before_front'
  ) into has_slots;

  if not has_slots then
    return;
  end if;

  -- Skip items that already have pairs (re-run safe).
  for r in
    select *
    from public.gallery_items gi
    where not exists (
      select 1 from public.gallery_pairs gp where gp.item_id = gi.id
    )
  loop
    if r.before_front is not null or r.after_front is not null then
      insert into public.gallery_pairs (item_id, sort_order, media_kind, before_path, after_path)
      values (r.id, 0, 'image', r.before_front, r.after_front);
    end if;

    if r.before_back is not null or r.after_back is not null then
      insert into public.gallery_pairs (item_id, sort_order, media_kind, before_path, after_path)
      values (r.id, 1, 'image', r.before_back, r.after_back);
    end if;

    if r.before_front_video is not null or r.after_front_video is not null then
      insert into public.gallery_pairs (item_id, sort_order, media_kind, before_path, after_path)
      values (r.id, 2, 'video', r.before_front_video, r.after_front_video);
    end if;

    if r.before_back_video is not null or r.after_back_video is not null then
      insert into public.gallery_pairs (item_id, sort_order, media_kind, before_path, after_path)
      values (r.id, 3, 'video', r.before_back_video, r.after_back_video);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Drop legacy columns
-- ---------------------------------------------------------------------------

alter table public.gallery_items
  drop column if exists paired_video_layout,
  drop column if exists before_front,
  drop column if exists after_front,
  drop column if exists before_back,
  drop column if exists after_back,
  drop column if exists before_front_video,
  drop column if exists after_front_video,
  drop column if exists before_back_video,
  drop column if exists after_back_video;

commit;

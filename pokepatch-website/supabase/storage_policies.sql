-- PokePatch: card-photos storage policies (additive only)
--
-- SAFETY
-- - Does not drop or alter existing policies (legacy uuid-folder uploads keep working).
-- - Does not delete storage objects or change an existing bucket's settings.
-- - Safe to re-run.
--
-- Run in Supabase SQL Editor only if order-* uploads fail with a storage policy error.
-- If anon can already insert into the whole card-photos bucket, you do not need this.

-- Ensure bucket exists; never overwrite an existing bucket's settings.
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', false)
on conflict (id) do nothing;

-- Add an order-path upload policy only if it is missing.
-- Leaves any existing policies (including legacy path policies) untouched.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'anon can upload order card photos'
  ) then
    create policy "anon can upload order card photos"
      on storage.objects
      for insert
      to anon
      with check (
        bucket_id = 'card-photos'
        and name like 'order-%'
      );
  end if;
end;
$$;

-- Service role (notify edge function) bypasses RLS for signed URLs; no policy needed.

-- PokePatch: allow logged-in customers to read published gallery rows.
--
-- Gallery RLS was granted only to `anon`. After customer auth, viewing /gallery
-- while signed in uses the `authenticated` role, so the public query returns
-- zero rows and the page silently falls back to static demo items.
-- Admin uses the same Supabase customer session, so this hits especially hard
-- right after uploading from /admin/gallery.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'gallery_items'
      and policyname = 'authenticated can read published gallery items'
  ) then
    create policy "authenticated can read published gallery items"
      on public.gallery_items
      for select
      to authenticated
      using (published = true);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'gallery_pairs'
      and policyname = 'authenticated can read pairs for published gallery items'
  ) then
    create policy "authenticated can read pairs for published gallery items"
      on public.gallery_pairs
      for select
      to authenticated
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

commit;

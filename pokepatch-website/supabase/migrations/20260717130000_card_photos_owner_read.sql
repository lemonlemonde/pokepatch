-- PokePatch: let customers read their own order photos (private bucket)
--
-- The card-photos bucket stays PRIVATE. This adds a storage RLS SELECT policy so
-- an authenticated customer can read (and therefore mint signed URLs for) only
-- the photos that belong to their own orders. Files are stored at
--   order-<order_id>/card-<card_id>/<filename>
-- so we derive the order id from the first path segment and check ownership
-- against public.orders.user_id.
--
-- SAFETY
-- - Additive: only creates a new SELECT policy if it does not already exist.
-- - Does not change the bucket's public/private setting.
-- - Does not touch existing upload policies, quote_requests, or *_original data.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'authenticated can read own order card photos'
  ) then
    create policy "authenticated can read own order card photos"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'card-photos'
        and exists (
          select 1
          from public.orders o
          where o.user_id = auth.uid()
            and split_part(name, '/', 1) = 'order-' || o.id::text
        )
      );
  end if;
end;
$$;

commit;

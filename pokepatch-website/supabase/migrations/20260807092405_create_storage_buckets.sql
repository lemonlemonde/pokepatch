-- Create the storage buckets the app needs, and the card-photos upload
-- policies that go with them.
--
-- Both buckets were made through the Supabase dashboard on the hosted project,
-- and the policies were pasted into the SQL editor from
-- supabase/storage_policies.sql, so nothing in this repo ever created either.
-- A local stack built from migrations came up with no bucket at all ("Bucket
-- not found"), and then with no upload policy ("new row violates row-level
-- security policy").
--
-- Everything here is conditional, so it is a no-op against the hosted project
-- where all of it already exists. Additive only: no existing policy is dropped
-- or altered, and no existing bucket's settings are changed.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('card-photos', 'card-photos', false),
  ('gallery', 'gallery', true)
ON CONFLICT (id) DO NOTHING;

-- Guests upload card photos before an order row exists, so the policy is keyed
-- to the order-* path prefix rather than to ownership.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'anon can upload order card photos'
  ) THEN
    CREATE POLICY "anon can upload order card photos"
      ON storage.objects
      FOR INSERT
      TO anon
      WITH CHECK (bucket_id = 'card-photos' AND name LIKE 'order-%');
  END IF;
END;
$$;

-- Logged-in customers submit as the authenticated role and need the same
-- permission, or a signed-in order fails on the photo upload.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'authenticated can upload order card photos'
  ) THEN
    CREATE POLICY "authenticated can upload order card photos"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'card-photos' AND name LIKE 'order-%');
  END IF;
END;
$$;

-- The notify edge function reads photos with the service role, which bypasses
-- RLS, so no select policy is needed here.

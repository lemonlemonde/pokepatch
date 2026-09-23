-- Per-order liability agreement: admin prepares a filled PDF; customer downloads,
-- signs offline, and uploads the signed copy.

CREATE TABLE public.order_contracts (
  order_id uuid PRIMARY KEY REFERENCES public.orders (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ready', 'signed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  unsigned_path text,
  signed_path text,
  prepared_at timestamptz,
  signed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_contracts IS
  'Optional property/liability agreement per order. Admin prepares unsigned PDF; customer uploads signed PDF.';

CREATE INDEX order_contracts_status_idx ON public.order_contracts (status);

ALTER TABLE public.order_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read contracts for their orders"
  ON public.order_contracts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_contracts.order_id
        AND o.user_id = auth.uid()
    )
  );

-- Customer marks signed after uploading to storage (path ownership checked here).
CREATE OR REPLACE FUNCTION public.submit_signed_order_contract(
  p_order_id uuid,
  p_signed_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_expected text;
  v_row public.order_contracts%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'order not found or access denied';
  END IF;

  v_expected := p_order_id::text || '/signed.pdf';
  IF trim(COALESCE(p_signed_path, '')) <> v_expected THEN
    RAISE EXCEPTION 'invalid signed path';
  END IF;

  UPDATE public.order_contracts
  SET
    signed_path = v_expected,
    status = 'signed',
    signed_at = now(),
    updated_at = now()
  WHERE order_id = p_order_id
    AND unsigned_path IS NOT NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not ready';
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_row.order_id,
    'status', v_row.status,
    'unsigned_path', v_row.unsigned_path,
    'signed_path', v_row.signed_path,
    'prepared_at', v_row.prepared_at,
    'signed_at', v_row.signed_at,
    'updated_at', v_row.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_signed_order_contract(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_signed_order_contract(uuid, text) TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('order-contracts', 'order-contracts', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'users can read own order contracts'
  ) THEN
    CREATE POLICY "users can read own order contracts"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'order-contracts'
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id::text = (string_to_array(name, '/'))[1]
            AND o.user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'users can upload signed order contract'
  ) THEN
    CREATE POLICY "users can upload signed order contract"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'order-contracts'
        AND name = (string_to_array(name, '/'))[1] || '/signed.pdf'
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id::text = (string_to_array(name, '/'))[1]
            AND o.user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'users can replace signed order contract'
  ) THEN
    CREATE POLICY "users can replace signed order contract"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'order-contracts'
        AND name = (string_to_array(name, '/'))[1] || '/signed.pdf'
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id::text = (string_to_array(name, '/'))[1]
            AND o.user_id = auth.uid()
        )
      )
      WITH CHECK (
        bucket_id = 'order-contracts'
        AND name = (string_to_array(name, '/'))[1] || '/signed.pdf'
        AND EXISTS (
          SELECT 1
          FROM public.orders o
          WHERE o.id::text = (string_to_array(name, '/'))[1]
            AND o.user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

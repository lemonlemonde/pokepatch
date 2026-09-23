-- Customer may only see/download/upload the agreement after admin notifies them.

ALTER TABLE public.order_contracts
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMENT ON COLUMN public.order_contracts.notified_at IS
  'Set when admin notifies the customer about the agreement; required for customer visibility.';

-- Replace SELECT policy: ownership + notified.
DROP POLICY IF EXISTS "users can read contracts for their orders" ON public.order_contracts;

CREATE POLICY "users can read notified contracts for their orders"
  ON public.order_contracts
  FOR SELECT
  TO authenticated
  USING (
    notified_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_contracts.order_id
        AND o.user_id = auth.uid()
    )
  );

-- Signed submit only after notify.
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
    AND notified_at IS NOT NULL
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
    'notified_at', v_row.notified_at,
    'updated_at', v_row.updated_at
  );
END;
$function$;

-- Storage: only after notify.
DROP POLICY IF EXISTS "users can read own order contracts" ON storage.objects;
CREATE POLICY "users can read own order contracts"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-contracts'
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.order_contracts c ON c.order_id = o.id
      WHERE o.id::text = (string_to_array(name, '/'))[1]
        AND o.user_id = auth.uid()
        AND c.notified_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "users can upload signed order contract" ON storage.objects;
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
      JOIN public.order_contracts c ON c.order_id = o.id
      WHERE o.id::text = (string_to_array(name, '/'))[1]
        AND o.user_id = auth.uid()
        AND c.notified_at IS NOT NULL
        AND c.unsigned_path IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "users can replace signed order contract" ON storage.objects;
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
      JOIN public.order_contracts c ON c.order_id = o.id
      WHERE o.id::text = (string_to_array(name, '/'))[1]
        AND o.user_id = auth.uid()
        AND c.notified_at IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'order-contracts'
    AND name = (string_to_array(name, '/'))[1] || '/signed.pdf'
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.order_contracts c ON c.order_id = o.id
      WHERE o.id::text = (string_to_array(name, '/'))[1]
        AND o.user_id = auth.uid()
        AND c.notified_at IS NOT NULL
    )
  );

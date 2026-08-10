-- Return canceled order details for customer notification; cron invokes edge function.

DROP FUNCTION IF EXISTS public.cancel_stale_pending_quotes();

CREATE FUNCTION public.cancel_stale_pending_quotes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH stale AS (
    SELECT
      o.id,
      o.display_id,
      o.customer_email,
      o.customer_name,
      o.user_id
    FROM public.orders o
    WHERE o.status = 'pending'
      AND o.pending_kind = 'quote'
      AND COALESCE(o.status_changed_at, o.created_at) <= now() - interval '14 days'
  ),
  updated AS (
    UPDATE public.orders o
    SET
      status = 'canceled',
      pending_kind = NULL,
      completed_at = COALESCE(o.completed_at, now())
    FROM stale s
    WHERE o.id = s.id
    RETURNING
      o.id,
      o.display_id,
      o.customer_email,
      o.customer_name,
      o.user_id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
  INTO v_result
  FROM updated;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.cancel_stale_pending_quotes() IS
  'Cancels pending-quote orders idle for 14+ days; returns canceled rows for notification.';

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'cancel-stale-pending-quotes';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

-- Daily at 08:00 UTC — cancel in SQL, then notify customers via edge function.
SELECT cron.schedule(
  'cancel-stale-pending-quotes',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
    ) || '/functions/v1/cancel-stale-quotes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

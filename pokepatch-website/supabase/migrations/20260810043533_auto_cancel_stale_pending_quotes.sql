-- Cancel pending-quote orders that have sat in the kanban Pending column for >= 14 days.
-- Uses status_changed_at (when the order entered pending, or last pending-kind timer reset).

CREATE OR REPLACE FUNCTION public.cancel_stale_pending_quotes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.orders o
  SET
    status = 'canceled',
    pending_kind = NULL,
    completed_at = COALESCE(o.completed_at, now())
  WHERE o.status = 'pending'
    AND o.pending_kind = 'quote'
    AND COALESCE(o.status_changed_at, o.created_at) <= now() - interval '14 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.cancel_stale_pending_quotes() IS
  'Moves pending-quote orders idle for 14+ days to canceled. Intended for pg_cron.';

-- pg_cron is available on hosted Supabase; enable if not already present.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

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

-- Daily at 08:00 UTC.
SELECT cron.schedule(
  'cancel-stale-pending-quotes',
  '0 8 * * *',
  $$SELECT public.cancel_stale_pending_quotes();$$
);

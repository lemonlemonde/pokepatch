-- Remove per-card restoration timers (admin Timers page + Discord cron).

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'notify-card-timers';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS cards_clear_timer_when_not_in_progress ON public.cards;
DROP FUNCTION IF EXISTS public.cards_clear_timer_when_not_in_progress();

DROP INDEX IF EXISTS public.cards_timer_due_idx;

ALTER TABLE public.cards
  DROP COLUMN IF EXISTS timer_ends_at,
  DROP COLUMN IF EXISTS timer_notified_at;

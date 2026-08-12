-- Per-card restoration timers for admin; Discord ping when due.

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS timer_ends_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS timer_notified_at timestamp with time zone;

COMMENT ON COLUMN public.cards.timer_ends_at IS
  'When the admin restoration countdown ends; null if no active timer.';
COMMENT ON COLUMN public.cards.timer_notified_at IS
  'When Discord was notified that the timer finished; null until fired.';

CREATE INDEX IF NOT EXISTS cards_timer_due_idx
  ON public.cards (timer_ends_at)
  WHERE timer_ends_at IS NOT NULL
    AND timer_notified_at IS NULL
    AND status = 'in_progress';

-- Drop timer state whenever the card leaves in_progress (completed, todo, canceled).
CREATE OR REPLACE FUNCTION public.cards_clear_timer_when_not_in_progress()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'in_progress' THEN
    NEW.timer_ends_at := NULL;
    NEW.timer_notified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cards_clear_timer_when_not_in_progress ON public.cards;
CREATE TRIGGER cards_clear_timer_when_not_in_progress
  BEFORE UPDATE OF status ON public.cards
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.cards_clear_timer_when_not_in_progress();

-- Cron: every minute, invoke edge function to Discord-notify due timers.
-- Requires vault secrets `project_url` and `service_role_key` (same as
-- cancel-stale-pending-quotes). Edge function needs CARD_TIMER_DISCORD_WEBHOOK_URL.
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

SELECT cron.schedule(
  'notify-card-timers',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
    ) || '/functions/v1/notify-card-timers',
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

-- Rate-limit log for the "you already have an account" signup notice email.
-- Only the account-signup-notice edge function (service role) touches this
-- table, so RLS is enabled with no policies — service role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.account_signup_notice_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_signup_notice_log_email_sent_at_idx
  ON public.account_signup_notice_log (email, sent_at DESC);

ALTER TABLE public.account_signup_notice_log ENABLE ROW LEVEL SECURITY;

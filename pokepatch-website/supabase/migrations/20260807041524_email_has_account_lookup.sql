-- Lets the public quote form ask "does this email already have an account?"
-- so it can prompt the visitor to log in instead of filing a guest order under
-- an address someone else already owns.
--
-- auth.users is not readable by anon, so this is SECURITY DEFINER. It returns a
-- bare boolean and never leaks anything else about the account. That is still
-- an enumeration oracle by design (the whole point is telling the visitor their
-- email is taken), so lookups are logged and throttled per email address.

CREATE TABLE IF NOT EXISTS public.account_lookup_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  looked_up_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_lookup_log_email_looked_up_at_idx
  ON public.account_lookup_log (email, looked_up_at DESC);

-- Serves the sweep below, which is a plain range scan over the whole table.
CREATE INDEX IF NOT EXISTS account_lookup_log_looked_up_at_idx
  ON public.account_lookup_log (looked_up_at);

-- Only the SECURITY DEFINER function below writes here; RLS on with no
-- policies means nothing else can read or write it.
ALTER TABLE public.account_lookup_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.email_has_account(p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_recent_lookups int;
begin
  v_email := lower(trim(coalesce(p_email, '')));

  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return false;
  end if;

  -- Nothing outside the throttle window is ever read, so drop it. Without this
  -- the table grows one row per lookup forever, and anon drives the inserts.
  -- ponytail: swept inline on every call rather than on a schedule — cheap
  -- because it runs constantly and so finds little, but it is one extra write
  -- per lookup. Move to pg_cron if lookup volume ever makes that matter.
  delete from public.account_lookup_log
   where looked_up_at <= now() - interval '1 hour';

  -- Throttle repeated probing of the same address. The caller treats an
  -- exception as "couldn't check" and lets the submission through, so a
  -- throttled visitor is never blocked from ordering.
  select count(*)
    into v_recent_lookups
    from public.account_lookup_log
   where email = v_email
     and looked_up_at > now() - interval '1 hour';

  if v_recent_lookups >= 10 then
    raise exception 'too many account lookups for this email; try again later';
  end if;

  insert into public.account_lookup_log (email) values (v_email);

  return exists (
    select 1 from auth.users
     where lower(email) = v_email
       and deleted_at is null
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.email_has_account(text) FROM public;
GRANT EXECUTE ON FUNCTION public.email_has_account(text) TO anon, authenticated;

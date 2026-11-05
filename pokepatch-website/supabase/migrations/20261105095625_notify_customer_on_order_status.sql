-- Email the customer whenever the *order* status (or pending kind) changes.
-- Per-card status flips stay silent. Discord still only fires on orders INSERT
-- (`notify`); this trigger calls a separate function so admin edits don't spam
-- the quotes channel.
--
-- Hosted URL is the default; local-stack retarget replaces the trigger argument.

CREATE OR REPLACE FUNCTION public.orders_notify_customer_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'extensions'
AS $$
DECLARE
  v_url text;
  v_headers jsonb;
BEGIN
  v_url := nullif(trim(coalesce(TG_ARGV[0], '')), '');
  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_headers := coalesce(TG_ARGV[1], '{"Content-Type":"application/json"}')::jsonb;
  EXCEPTION
    WHEN others THEN
      v_headers := '{"Content-Type":"application/json"}'::jsonb;
  END;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW),
      'old_record', to_jsonb(OLD)
    ),
    headers := v_headers,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.orders_notify_customer_on_status_change() IS
  'POST old/new order rows to notify-order-status when status or pending_kind changes.';

DROP TRIGGER IF EXISTS orders_status_notify_customer ON public.orders;
CREATE TRIGGER orders_status_notify_customer
  AFTER UPDATE OF status, pending_kind ON public.orders
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.pending_kind IS DISTINCT FROM NEW.pending_kind
  )
  EXECUTE FUNCTION public.orders_notify_customer_on_status_change(
    'https://tmdbqymvjphhfvgyimnb.supabase.co/functions/v1/notify-order-status',
    '{"Content-Type":"application/json"}'
  );

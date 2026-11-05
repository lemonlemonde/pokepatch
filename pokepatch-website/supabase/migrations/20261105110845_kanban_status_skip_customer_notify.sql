-- Kanban drag is the only order-status change that may skip the customer
-- email. Application code calls update_order_kanban, which sets a
-- transaction-local flag the notify trigger honors.

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
  IF current_setting('app.skip_order_status_notify', true) = 'true' THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION public.update_order_kanban(
  p_order_id uuid,
  p_order jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.skip_order_status_notify', 'true', true);
  RETURN public.update_order(p_order_id, p_order, NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_kanban(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_order_kanban(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.orders_notify_customer_on_status_change() IS
  'POST old/new order rows to notify-order-status when status or pending_kind changes, unless app.skip_order_status_notify is true.';

COMMENT ON FUNCTION public.update_order_kanban(uuid, jsonb) IS
  'Same write as update_order; skips the customer status email so kanban Move only can stay silent.';

#!/bin/sh
# Point orders/quote_requests INSERT triggers at the *local* notify function,
# and orders status/pending_kind UPDATE at local notify-order-status.
# Baseline / later migrations hardcode the hosted project URL; without this,
# local quote submits and status emails would hit production.
set -eu
cd "$(dirname "$0")/.."

if ! supabase status >/dev/null 2>&1; then
  echo "local Supabase isn't running" >&2
  exit 1
fi

eval "$(supabase status -o env | sed 's/^/SB_/')"

if [ -z "${SB_SERVICE_ROLE_KEY:-}" ]; then
  echo "supabase status did not report SERVICE_ROLE_KEY" >&2
  exit 1
fi
if [ -z "${SB_DB_URL:-}" ]; then
  echo "supabase status did not report DB_URL" >&2
  exit 1
fi

# Postgres runs in Docker — 127.0.0.1 inside the DB container is not the API.
# host.docker.internal reaches the host (Docker Desktop / Mac).
port="$(printf '%s' "${SB_API_URL:-http://127.0.0.1:54321}" | sed -E 's|^https?://[^:]+:([0-9]+).*|\1|')"
if [ -z "$port" ] || [ "$port" = "${SB_API_URL:-}" ]; then
  port=54321
fi
notify_url="http://host.docker.internal:${port}/functions/v1/notify"
status_notify_url="http://host.docker.internal:${port}/functions/v1/notify-order-status"

# Escape single quotes for SQL string literals.
svc="$(printf '%s' "$SB_SERVICE_ROLE_KEY" | sed "s/'/''/g")"
headers="{\"Content-Type\":\"application/json\",\"Authorization\":\"Bearer ${svc}\"}"
headers_sql="$(printf '%s' "$headers" | sed "s/'/''/g")"

sql_file="$(mktemp)"
trap 'rm -f "$sql_file"' EXIT

cat >"$sql_file" <<SQL
DROP TRIGGER IF EXISTS "orders-insert-notify" ON public.orders;
CREATE TRIGGER "orders-insert-notify"
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION supabase_functions.http_request(
  '${notify_url}',
  'POST',
  '${headers_sql}',
  '{}',
  '5000'
);

DROP TRIGGER IF EXISTS "notify-discord-n-google-sheets" ON public.quote_requests;
CREATE TRIGGER "notify-discord-n-google-sheets"
AFTER INSERT ON public.quote_requests
FOR EACH ROW
EXECUTE FUNCTION supabase_functions.http_request(
  '${notify_url}',
  'POST',
  '${headers_sql}',
  '{}',
  '5000'
);

DROP TRIGGER IF EXISTS orders_status_notify_customer ON public.orders;
CREATE TRIGGER orders_status_notify_customer
AFTER UPDATE OF status, pending_kind ON public.orders
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.pending_kind IS DISTINCT FROM NEW.pending_kind
)
EXECUTE FUNCTION public.orders_notify_customer_on_status_change(
  '${status_notify_url}',
  '${headers_sql}'
);
SQL

# `supabase db query --file` only accepts a single statement.
psql "$SB_DB_URL" -v ON_ERROR_STOP=1 -f "$sql_file" >/dev/null

echo "notify triggers -> ${notify_url}"
echo "order-status notify -> ${status_notify_url}"

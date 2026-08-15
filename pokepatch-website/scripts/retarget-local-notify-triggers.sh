#!/bin/sh
# Point orders/quote_requests INSERT triggers at the *local* notify function.
# Baseline migration hardcodes the hosted project URL; without this, local
# quote submits would hit production notify.
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

# Postgres runs in Docker — 127.0.0.1 inside the DB container is not the API.
# host.docker.internal reaches the host (Docker Desktop / Mac).
port="$(printf '%s' "${SB_API_URL:-http://127.0.0.1:54321}" | sed -E 's|^https?://[^:]+:([0-9]+).*|\1|')"
if [ -z "$port" ] || [ "$port" = "${SB_API_URL:-}" ]; then
  port=54321
fi
notify_url="http://host.docker.internal:${port}/functions/v1/notify"

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
SQL

supabase db query --local --file "$sql_file" >/dev/null

echo "notify triggers -> ${notify_url}"

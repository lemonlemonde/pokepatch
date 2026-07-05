# Admin edge functions

Password-gated admin UI for PokePatch orders. The browser never sees `ADMIN_PASSWORD` or the service role key — only a short-lived session token after login.

## Functions

| Function | Path | Role |
|----------|------|------|
| `admin-auth` | `/functions/v1/admin-auth` | Login, logout, validate session |
| `admin-api` | `/functions/v1/admin-api` | List/get/save orders, set status, upload admin photos |

Both are deployed with `--no-verify-jwt` (same pattern as `notify`). Requests still send the Supabase anon `apikey` header; admin actions also send `X-Admin-Token`.

## Secrets

| Secret | Purpose |
|--------|---------|
| `ADMIN_PASSWORD` | Shared admin login password (server-side only) |

Auto-injected by Supabase (do not set manually):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Database prerequisites

Run the admin migration before deploying:

[`supabase/migrations/20260704120000_admin_orders.sql`](../migrations/20260704120000_admin_orders.sql)

Adds:

- `orders.status` (`new`, `in_progress`, `completed`, `delivered`)
- Expanded `card_images.image_type` values for admin uploads
- `admin_sessions` table
- `update_order` status support

## Deploy (manual)

From `pokepatch-website/`:

```bash
supabase secrets set ADMIN_PASSWORD="long-random-admin-password"
supabase functions deploy admin-auth --no-verify-jwt
supabase functions deploy admin-api --no-verify-jwt
```

Then deploy the static site so `/admin/` is available.

## Safety

- Does **not** modify `notify`, `quote_requests`, or `*_original` tables
- Admin writes go to **working** tables only via `update_order` (service role)
- No `orders` UPDATE webhook — admin edits stay silent (no Discord/Sheets)
- Customer submission photos are read-only in the UI

## Frontend

- Route: `/admin/` (not linked in public nav)
- Client: [`src/lib/adminApi.js`](../../src/lib/adminApi.js)
- UI: [`src/components/admin/AdminApp.js`](../../src/components/admin/AdminApp.js)

Session token is stored in `sessionStorage` under `pokepatch-admin-token`.

## API actions

### admin-auth (JSON POST)

| Body | Response |
|------|----------|
| `{ "action": "login", "password": "..." }` | `{ ok, token, expires_at }` |
| `{ "action": "logout" }` + `X-Admin-Token` | `{ ok: true }` |
| `{ "action": "validate" }` + `X-Admin-Token` | `{ ok: true }` or 401 |

### admin-api

JSON POST (requires `X-Admin-Token`):

| action | Body fields |
|--------|-------------|
| `list` | — |
| `get` | `order_id` |
| `set_status` | `order_id`, `status` |
| `save` | `order_id`, `order`, `contacts`, `cards` |

Multipart POST (requires `X-Admin-Token`):

- `order_id`, `card_id`, `image_type` (`progress_front`, `progress_back`, `final_front`, `final_back`, `admin`), `file`

Admin photo storage path:

`order-{orderId}/card-{cardId}/{image_type}-{n}-{filename}`

Signed URLs (1 year) are returned in list/get payloads.

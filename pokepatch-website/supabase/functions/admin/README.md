# Admin edge functions

Email-gated admin UI for PokePatch orders. The browser never sees
`ADMIN_ALLOWED_EMAILS` or the service role key — only a short-lived session
token after login.

## Functions

| Function | Path | Role |
|----------|------|------|
| `admin-auth` | `/functions/v1/admin-auth` | Login, logout, validate session |
| `admin-api` | `/functions/v1/admin-api` | List/get/save/delete orders, set status, upload admin photos, gallery CMS, broadcast messages |

Both are deployed with `--no-verify-jwt` (same pattern as `notify`). Requests still send the Supabase anon `apikey` header; admin actions also send `X-Admin-Token`.

## Secrets

| Secret | Purpose |
|--------|---------|
| `ADMIN_ALLOWED_EMAILS` | Comma-separated emails allowed to mint an admin session via customer JWT |
| `RESEND_API_KEY` | Resend API key for admin broadcast emails (`messages_send`) |
| `RESEND_FROM_EMAIL` | Verified From address, e.g. `PokePatch <noreply@pokepatch.cards>` |
| `RESEND_LOGO_URL` | Optional override for the email header logo (default `https://pokepatch.cards/email/pokepatch-icon.png`) |

Auto-injected by Supabase (do not set manually):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Database prerequisites

Live Supabase is the source of truth. These objects must already exist before
deploying admin functions (they do on production):

**Admin orders**
- `orders.status` (`new`, `on_hold`, `in_progress`, `completed`, `canceled`)
- Expanded `card_images.image_type` values for admin uploads
- `admin_sessions` table
- `update_order` status support

**Gallery CMS**
- `gallery_items` table (anon can SELECT published rows; ordered by `created_at` desc)
- `gallery_pairs` before/after media rows
- Public `gallery` storage bucket + read policy
- `set_name` and `damage_tags` on `gallery_items`

**Customer messages**
- `customer_messages` table + order-linked RLS / related RPCs (shown on My Orders)

Future schema changes use CLI-managed migrations from `pokepatch-website/` (`migration new` → `db push`). Do not hand-name files or apply remote DDL without `migration fetch --linked` — see the root [README → Schema changes (CLI-managed)](../../../../README.md#schema-changes-cli-managed).

```bash
supabase migration new <short_name>
supabase db push
supabase migration list
```

Apply pending migrations before deploying if the function depends on new schema.

Optional one-time seed of existing `public/gallery` files:

```bash
# from pokepatch-website/; requires SUPABASE_SERVICE_ROLE_KEY in .env.local
node --env-file=.env.local scripts/seed-gallery.mjs
```

## Deploy (manual)

From `pokepatch-website/`:

```bash
supabase secrets set ADMIN_ALLOWED_EMAILS="you@example.com"
supabase secrets set RESEND_API_KEY="re_..." RESEND_FROM_EMAIL="PokePatch <noreply@pokepatch.cards>"
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

- Route: `/admin/` — Orders, Gallery, Messages, Studio tabs; **Admin** appears in the main navbar for allowlisted signed-in emails
- Client: [`src/lib/adminApi.js`](../../src/lib/adminApi.js)
- UI: [`src/components/admin/AdminApp.js`](../../src/components/admin/AdminApp.js)
- Gallery UI: [`src/components/admin/GalleryManager.js`](../../src/components/admin/GalleryManager.js)
- Order send-update UI: [`src/components/admin/OrderSendUpdate.js`](../../src/components/admin/OrderSendUpdate.js)

Session token is stored in `sessionStorage` under `pokepatch-admin-token`.

## API actions

### admin-auth (JSON POST)

| Body | Response |
|------|----------|
| `{ "action": "loginWithSession" }` + `Authorization: Bearer <user JWT>` | `{ ok, token, expires_at }` if email is allowlisted |
| `{ "action": "logout" }` + `X-Admin-Token` | `{ ok: true }` |
| `{ "action": "validate" }` + `X-Admin-Token` | `{ ok: true }` or 401 |

### admin-api

JSON POST (requires `X-Admin-Token`):

| action | Body fields |
|--------|-------------|
| `list` | — |
| `get` | `order_id` |
| `set_status` | `order_id`, `status` |
| `delete` | `order_id` or `order_ids` (array) |
| `delete_photo` | `order_id`, `image_id` — removes an admin-uploaded card photo (not `customer`) |
| `save` | `order_id`, `order`, `contacts`, `cards` — cards list is authoritative; omitted cards (and their photos) are deleted |
| `gallery_list` | — |
| `gallery_get` | `id` |
| `gallery_create` | `title`, optional `set_name`, `damage_tags`, `published` |
| `gallery_save` | `id` + fields to update |
| `gallery_delete` | `id` |
| `gallery_pair_create` | `item_id`, optional `media_kind` (`image` \| `video`) |
| `gallery_pair_delete` | `pair_id` |
| `gallery_pair_reorder` | `item_id`, `ordered_ids` |
| `gallery_pair_clear_side` | `pair_id`, `side` (`before` \| `after`) |
| `messages_list_orders` | optional `limit` — recent orders (legacy/helper) |
| `messages_history` | optional `email`, optional `order_id`, `limit` (includes `order_display_id`) |
| `messages_send` | `subject`, `body`, `order_ids[]` (required; typically one order from the editor) |

Multipart POST (requires `X-Admin-Token`):

Order photos:

- `kind=order` (default), `order_id`, `card_id`, `image_type` (`customer`, `progress_front`, `progress_back`, `final_front`, `final_back`, `admin`), `file`
- Path: `order-{orderId}/card-{cardId}/{image_type}-{n}-{filename}`

Gallery media:

- `kind=gallery`, `pair_id`, `side` (`before` \| `after`), `file`
- Path: `item-{itemId}/pair-{pairId}/{side}-{filename}` in the public `gallery` bucket

Signed URLs (1 year) are returned for order photo list/get payloads. Gallery responses include public `urls` for each pair side.

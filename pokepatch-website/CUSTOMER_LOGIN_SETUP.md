# Customer login & order tracking

Optional accounts so customers can track quotes and restorations online. Guests can still submit quotes without signing up; matching email links orders after signup.

## What customers get

- **Quote without an account** — existing `/quote` flow unchanged
- **Optional signup** on thank-you / login using the same email → orders auto-link
- **My Orders** (`/my-orders`) — list of linked orders; open one for detail, messages, and pending edits
- **Unread messages** — navbar badge + per-order chips when admin messages arrive
- **Account** (`/account`) — profile + password change (login email is not editable there)

## Auth setup (Supabase + Resend)

Customer schema (`orders.user_id`, `get_my_orders` / `get_my_order`, RLS, messages RPCs) is already on live. Schema changes: CLI migrations from `pokepatch-website/` — see root [README → Schema changes](../README.md#schema-changes-cli-managed).

### Email (Resend SMTP)

Supabase’s built-in mailer is rate-limited. For production Auth mail:

1. Verify a domain in [Resend](https://resend.com) and create an API key
2. Supabase → **Authentication → Email → SMTP**: `smtp.resend.com`, port `465`, user `resend`, password = API key, From = verified address
3. Keep **Confirm email** on (site `/verify-email` expects it)
4. **URL Configuration**: Site URL + redirect allowlist for prod and localhost
5. Use repo templates `supabase/templates/confirmation.html` and `recovery.html` in the dashboard (and `config.toml` for local)

Signup passes `emailRedirectTo` → `/my-orders` on the current origin.

### Env

```
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=…
```

Feature flag: `src/lib/customerAuth.js` (`isCustomerAuthEnabled`).

## Admin → customer messages

From an order editor, admins send updates via `admin-api` + Resend HTTP API. Messages land in `customer_messages` and show on My Orders detail.

```bash
supabase secrets set RESEND_API_KEY="re_…" RESEND_FROM_EMAIL="PokePatch <noreply@pokepatch.cards>"
```

Redeploy `admin-api` after secret changes. `ADMIN_ALLOWED_EMAILS` must stay set.

## Main app surfaces

| Path | Role |
|------|------|
| `/quote` | Public quote form |
| `/thank-you` | Confirmation + optional signup |
| `/login` | Login / signup / forgot password |
| `/my-orders` | Order list |
| `/my-orders/detail?id=…` | Order detail, messages, edit when pending |
| `/account` | Profile + password |
| `/admin/orders` | Admin board (messages live on the order editor) |

## Troubleshooting

- **Auth not configured** — set the `NEXT_PUBLIC_SUPABASE_*` env vars
- **Confirm emails missing** — Resend SMTP + domain verify; check Resend email log
- **Orders not linking** — signup email must match the quote contact email (match is case-insensitive)
- **Photos missing** — `card-photos` bucket public + read policies

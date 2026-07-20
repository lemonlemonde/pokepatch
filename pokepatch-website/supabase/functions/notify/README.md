# Supabase Edge Function: `notify`

Handles notifications for both:

1. **Legacy** `quote_requests` INSERT → Discord + Requests sheet (`SHEETS_*` secrets)
2. **Orders** `orders` INSERT → Discord + Orders sheet (`ORDERS_SHEETS_*` secrets)

For new orders it:

1. Loads related `contacts`, `cards`, and `card_images` with the service role key
2. Creates **signed URLs** for customer photos
3. Posts a **Discord** message (`New Order #42`) with link to `ORDERS_SHEET_VIEW_URL`
4. Appends a summary row to the **Orders** Google Sheet tab via Apps Script

The service role key never touches the frontend — only this server-side function.

Admin `update_order` calls do **not** notify (no webhook on UPDATE).

---

## 1. Database prerequisites

The orders schema (`orders`, `contacts`, `cards`, `card_images`, related RPCs)
is already on live. Do **not** drop `quote_requests` (legacy path still used).

Future schema changes use CLI-managed migrations from `pokepatch-website/`:

```bash
supabase migration new <short_name>
supabase db push
```

See the root [README → Schema changes (CLI-managed)](../../../../README.md#schema-changes-cli-managed).

Optional storage policies (if bucket/policies are missing):

- [`supabase/storage_policies.sql`](../../storage_policies.sql)

---

## 2. Deploy the function

From `pokepatch-website/`:

```bash
supabase login
supabase link --project-ref tmdbqymvjphhfvgyimnb

# Existing secrets (leave unchanged for legacy quote_requests)
# DISCORD_WEBHOOK_URL
# SHEETS_WEBHOOK_URL
# SHEETS_SECRET
# SHEET_VIEW_URL

# New secrets for the orders pipeline
supabase secrets set ORDERS_SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/XXXX/exec"
supabase secrets set ORDERS_SHEETS_SECRET="new-long-random-string-matching-orders-gs-SHARED_SECRET"
supabase secrets set ORDERS_SHEET_VIEW_URL="https://docs.google.com/spreadsheets/d/XXXX/edit#gid=ORDERS_TAB"

supabase functions deploy notify --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### Secrets reference

| Secret | Purpose |
|--------|---------|
| `DISCORD_WEBHOOK_URL` | Shared Discord webhook (legacy + orders) |
| `SHEETS_WEBHOOK_URL` / `SHEETS_SECRET` | Legacy Requests tab (do **not** change) |
| `SHEET_VIEW_URL` | Legacy Discord spreadsheet link |
| `ORDERS_SHEETS_WEBHOOK_URL` | New Orders Apps Script `/exec` URL |
| `ORDERS_SHEETS_SECRET` | Must match `SHARED_SECRET` in `google-sheets-webhook-orders.gs` |
| `ORDERS_SHEET_VIEW_URL` | Discord link for new orders (Orders tab) |

---

## 3. Database webhooks

Supabase dashboard → **Database → Webhooks**:

### Legacy (keep existing)

- Table: `quote_requests`
- Events: **Insert**
- Type: **Supabase Edge Functions** → `notify`

### New (create)

- Table: `orders`
- Events: **Insert**
- Type: **Supabase Edge Functions** → `notify`
  (or HTTP Request POST to the function URL with header
  `Authorization: Bearer <anon key>`)

Do **not** add an UPDATE webhook on `orders` — admin edits must stay silent.

---

## 4. Google Sheets (Orders tab)

Google allows only one bound Apps Script per spreadsheet. Leave the legacy Requests script (Extensions → Apps Script) alone. Orders uses a **standalone** project:

1. Add an **Orders** tab on the spreadsheet (or let the script create it)
2. Copy the spreadsheet ID from the sheet URL
3. Go to [script.google.com](https://script.google.com) → **New project** (not Extensions → Apps Script)
4. Paste [`scripts/google-sheets-webhook-orders.gs`](../../../scripts/google-sheets-webhook-orders.gs)
5. Set `SHARED_SECRET` (new string, not the legacy secret) and `SPREADSHEET_ID`
6. Deploy → New deployment → Web app: Execute as **Me**, Who has access: **Anyone**
7. Copy `/exec` URL → `ORDERS_SHEETS_WEBHOOK_URL`
8. Set `ORDERS_SHEET_VIEW_URL` to the Orders tab URL

Legacy [`scripts/google-sheets-webhook.gs`](../../../scripts/google-sheets-webhook.gs) and the **Requests** tab stay as-is.

---

## 5. Test

Submit a quote on `/contact/`, then confirm:

- Rows in `orders`, `contacts`, `cards`, `card_images`
- Matching rows in `*_original` tables
- Photos under `card-photos/order-<uuid>/card-<uuid>/...`
- Discord: `New Order #N` with `ORDERS_SHEET_VIEW_URL`
- New row on the **Orders** sheet tab

Admin `update_order` (service role) should change working tables only and **not** post to Discord/Sheets.

Legacy: INSERT into `quote_requests` should still hit Discord + Requests tab.

---

## Notes

- Signed URLs expire after 1 year (`SIGNED_URL_EXPIRES_IN` in `index.ts`).
- Public display IDs come from `orders.display_id` (bigint identity).
- Public form calls `create_order` only; `update_order` is service_role only.

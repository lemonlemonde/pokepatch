# Supabase Edge Function: `notify`

On each new `quote_requests` insert, this function:

1. Creates **signed URLs** for the uploaded photos using the service role key.
2. Posts a **Discord** message: `New Quote Request #17: Shipping, 3 images, <contact>` with clickable photo links.
3. Forwards the request to a **Google Sheet** (via Apps Script) with clickable links.

The service role key never touches the frontend — only this server-side function.

## 1. Deploy the function

From `pokepatch-website/`:

```bash
supabase login
supabase link --project-ref tmdbqymvjphhfvgyimnb

# Discord webhook (regenerate it if it was ever shared)
supabase secrets set DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."

# Google Sheet (from scripts/google-sheets-webhook.gs deployment)
supabase secrets set SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/XXXX/exec"
supabase secrets set SHEETS_SECRET="same-long-random-string-as-SHARED_SECRET-in-the-gs-file"

# Spreadsheet link shown in every Discord message
supabase secrets set SHEET_VIEW_URL="https://docs.google.com/spreadsheets/d/XXXX/edit"

supabase functions deploy notify --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — you do **not** set them.

If you only want Discord (no Sheet) or vice versa, just omit the secrets you don't need.

## 2. Create the Database Webhook

Supabase dashboard → **Database → Webhooks → Create**:

- Table: `quote_requests`
- Events: **Insert**
- Type: **Supabase Edge Functions** → select **notify**
  (or HTTP Request POST to the function URL with header
  `Authorization: Bearer <anon key>`)

## 3. Test

Submit a quote on `/contact/`, then confirm:

- A row appears in `quote_requests`
- Photos are in Storage under `card-photos/<uuid>/...`
- Discord message arrives with working photo links
- A new row (with clickable links) appears in the Google Sheet

## Notes

- Signed URLs expire after 1 year (`SIGNED_URL_EXPIRES_IN` in `index.ts`). Adjust if needed.
- Display IDs come from the `id bigint generated always as identity` column — see `supabase/schema.sql`.

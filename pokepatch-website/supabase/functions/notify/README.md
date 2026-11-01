# Supabase Edge Function: `notify`

Handles notifications for both:

1. **Legacy** `quote_requests` INSERT → Discord
2. **Orders** `orders` INSERT → Discord + customer confirmation email

For new orders it:

1. ACKs the webhook immediately and finishes in the background (`EdgeRuntime.waitUntil`) — one message per card takes longer than the DB webhook waits
2. Loads related `contacts`, `cards`, and `card_images` with the service role key
3. Creates **signed URLs** for customer photos (1 year)
4. Posts to **Discord** via the bot into `DISCORD_QUOTES_CHANNEL_ID`:
   - a header (`New Order #42`: customer, delivery, contacts, card/photo counts, admin link)
   - a **thread** on that header (`#42 · Customer`, auto-archives after 7 days idle) containing:
     - **one message per card**: name/set, damage tags, description, all customer photos, and an **Add quote** button
     - a **wrap-up** as the last message: all contact methods, quote overview + total, the copy-and-paste outreach message, last-notified time, and **Save & notify** / **Refresh** buttons
   - buttons are handled by [`discord-interactions`](../discord-interactions/README.md)
5. Sends the customer a "we received your quote request" email

Message rendering lives in [`_shared/discordOrderMessages.ts`](../_shared/discordOrderMessages.ts) so card and wrap-up messages can be re-rendered after a quote is saved or the customer is notified from Discord.

If `DISCORD_QUOTES_BOT_TOKEN` / `DISCORD_QUOTES_CHANNEL_ID` are unset, messages fall back to `DISCORD_WEBHOOK_URL` — same layout posted flat into the channel (webhooks can't open threads or carry buttons), so the quote / notify flows are unavailable.

The service role key never touches the frontend — only this server-side function.

Admin `update_order` calls do **not** notify (no webhook on UPDATE).

---

## 1. Database prerequisites

The orders schema (`orders`, `contacts`, `cards`, `card_images`, related RPCs)
is already on live. Do **not** drop `quote_requests` (legacy path still used).

Future schema changes use CLI-managed migrations from `pokepatch-website/` (`migration new` → test locally → merge to `main`). CI runs `db push` + function deploy. Do not hand-name files or apply remote DDL without `migration fetch --linked` — see the root [README → Schema changes (CLI-managed)](../../../../README.md#schema-changes-cli-managed).

```bash
supabase migration new <short_name>
# test with npm run local / supabase db reset
# merge to main → CI db push + functions deploy
supabase migration list
```

Optional storage policies (if bucket/policies are missing):

- [`supabase/storage_policies.sql`](../../storage_policies.sql)

---

## 2. Deploy the function

From `pokepatch-website/`:

```bash
supabase login
supabase link --project-ref tmdbqymvjphhfvgyimnb

# Quotes Discord app (one message per card + quote buttons)
supabase secrets set DISCORD_QUOTES_BOT_TOKEN="bot-token"
supabase secrets set DISCORD_QUOTES_PUBLIC_KEY="hex-public-key"
supabase secrets set DISCORD_QUOTES_CHANNEL_ID="channel-id"

# Existing secret (legacy quote_requests + fallback when no bot token)
# DISCORD_WEBHOOK_URL

# Confirmation email (shared with admin-api)
# RESEND_API_KEY / RESEND_FROM_EMAIL

# Emergency only — normal path is merge to main (CI deploys all functions)
supabase functions deploy notify --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. `verify_jwt = false` is set for `notify` in `supabase/config.toml`.

### Secrets reference

| Secret | Purpose |
|--------|---------|
| `DISCORD_QUOTES_BOT_TOKEN` | Quotes Discord bot — posts order/card messages with buttons |
| `DISCORD_QUOTES_PUBLIC_KEY` | Quotes app Interactions signature (`discord-interactions`) |
| `DISCORD_QUOTES_CHANNEL_ID` | Channel the quotes bot posts into |
| `DISCORD_WEBHOOK_URL` | Legacy webhook; fallback when the bot isn't configured (no buttons) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Customer confirmation email |

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

## 4. Test

Submit a quote on `/quote/`, then confirm:

- Rows in `orders`, `contacts`, `cards`, `card_images`
- Matching rows in `*_original` tables
- Photos under `card-photos/order-<uuid>/card-<uuid>/...`
- Discord: `New Order #N` header with a thread; inside it one message per card with photos + **Add quote**, then the wrap-up (contacts, quote overview, outreach text, **Save & notify**)
- Press **Add quote** on a card → modal → submit → card message shows the quote and the wrap-up total updates; order flips to pending drop-off once all cards are quoted
- Press **Save & notify** on the wrap-up → modal preview → submit → customer email sent, `customer_messages` row created, wrap-up shows "Emailed …"

Admin `update_order` (service role) should change working tables only and **not** post to Discord.

Legacy: INSERT into `quote_requests` should still hit Discord.

---

## Notes

- Signed URLs expire after 1 year (`SIGNED_URL_EXPIRES_IN` in `index.ts`).
- Public display IDs come from `orders.display_id` (bigint identity).
- Public form calls `create_order` only; `update_order` is service_role only.

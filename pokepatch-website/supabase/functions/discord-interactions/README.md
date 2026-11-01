# Supabase Edge Function: `discord-interactions`

Single Discord **Interactions Endpoint** for the PokePatch app. Three flows:

| Flow | Trigger | File |
|------|---------|------|
| **Quote a card** | **Add quote** / **Edit quote** button on a card message inside the order thread posted by [`notify`](../notify/README.md) | [`quote.ts`](./quote.ts) |
| **Save & notify** / **Refresh** | Buttons on the **wrap-up** message (last message in the order thread) | [`notifyCustomer.ts`](./notifyCustomer.ts) |
| **wooper** (before/after photos) | Right-click a message with images → **Apps → wooper** | [`wooper.ts`](./wooper.ts) |

Only Discord user IDs listed in `DISCORD_ADMIN_USER_IDS` may use either flow.

---

## Quote a card from Discord

When a customer submits `/quote/`, `notify` posts a header message for the order into `DISCORD_QUOTES_CHANNEL_ID`, opens a **thread** on it (`#42 · Customer`), and posts **one message per card** into the thread, followed by a **wrap-up** message. Each card message has:

- card name · set, ⭐ if priority
- customer damage tags + description
- every customer photo (media gallery, up to 10)
- current quote (or _not quoted yet_)
- **Add quote** button + **Open in admin** link

Press **Add quote** → modal:

| Field | What it does |
|-------|--------------|
| **Services** (checkboxes) | Surface Cleaning, Minor Damage, Major Damage, Minor Whitening, Major Whitening, Slab Cracking — list price unless overridden |
| **Market value (Raw NM, $)** | Sets `cards.market_value_raw_nm`; the high-value fee is derived from the same tiers as admin ($200–$499 → 4%, $500+ → 8%) |
| **Price overrides** | `major 70, surface 15` — per-service price when it isn't list price. Naming a service here also adds it. Accepted names: `surface`, `minor damage`, `major damage`, `minor whitening`, `major whitening`, `slab` (short forms like `major` / `minor` / `whitening` resolve to whichever matching service is checked) |
| **Custom services** | One per line, `name amount` (e.g. `Holo re-foil 45`) |
| **Note to customer** | `cards.admin_note` — shown under the card in My Orders |

Submit → the function writes through **`update_order`** (same RPC as the admin editor):

- replaces this card's rows in `order_quote_items` (other cards' lines untouched)
- updates `market_value_raw_nm` + `admin_note` on the card
- rewrites the card's `card_hv` entry in `orders.quote_bulk_counts`
- `maybe_auto_pending_dropoff` flips the order to **pending drop-off** once every active card is quoted

Then the card message is re-rendered (quote lines, subtotal, green accent, button becomes **Edit quote**) and you get an ephemeral confirmation with `n/N cards quoted`. Re-opening the modal is prefilled from the stored quote, so edits are a matter of unchecking / changing a number. Unchecking everything and clearing the market value clears the quote.

Validation errors (unknown service name, bad amount) save **nothing** and tell you what to fix.

Saving a card quote also refreshes the thread's wrap-up message (quote overview + total).

Limits inherited from the data model: quote lines attach to a card by **name + set**, so two cards in one order with the identical name and set share quote lines (same as admin).

---

## Wrap-up: contacts, outreach text, Save & notify

The **last message in each order thread** is the wrap-up:

- **Contacts** — every contact method the customer entered (phone, Instagram as a profile link, Discord as a clickable `<@id>` mention when they gave a user ID) plus the order email
- **Quote overview** — per-card subtotal / _not quoted_ / canceled, order total (incl. HV, priority, adjustments), `n/N cards quoted`, order status
- **Quote message (copy & paste)** — the same outreach text the admin editor shows (`DEFAULT_OUTREACH_MESSAGE`, mirrored in [`_shared/outreach.ts`](../_shared/outreach.ts)) in a code block, so it has a copy button on hover
- **Last notified** — when the customer was last emailed about this order
- Buttons: **Save & notify**, **Refresh**, **Open in admin**

**Save & notify** opens a modal showing the exact quote summary that will be emailed (and a warning if any card is still unquoted), with **Subject** (prefilled `Your order quote has been updated`) and an optional **Message**. Submitting does what the admin editor's Save & notify does: inserts a `customer_messages` row (visible in the order's message history and My Orders) and sends the email through Resend with the quote changelog. Quotes are already saved per card, so there is nothing else to "save" here. The button is disabled when the order has no email — use the contacts above instead.

**Refresh** re-renders the wrap-up from the DB (e.g. after editing the order in admin).

---

## wooper (before/after photos)

1. Post your photos in a Discord channel (up to 10 attachments on one message).
2. **Right-click that message** → **Apps** → **wooper**.
3. Fill in **order number**, **card number** (1 = first card in the order), and optionally **side** (`before` or `after`).

**Side defaults** when left blank:

- Card has no `before` photos → `before`.
- Card has `before` but no `after` → `after`.
- Both sides already have photos → nothing is uploaded; the reply asks you to type `before` or `after` explicitly to replace that side.

Up to **20 photos per side** per card. Files over 15MB are rejected. **Each upload replaces that side** (DB rows + storage); `after` is untouched when uploading `before` and vice versa.

---

## 1. Discord application (once)

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → Add Bot → **Reset Token** → this is `DISCORD_BOT_TOKEN`. Disable "Public Bot" if you like.
3. **General Information** → copy **Public Key** → `DISCORD_PUBLIC_KEY`.
4. **OAuth2 → URL Generator**: scopes `applications.commands` + `bot`; bot permissions **View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Embed Links, Attach Files, Read Message History**. Invite it into the PokePatch server.
5. Developer Mode → right-click the quotes channel → **Copy Channel ID** → `DISCORD_QUOTES_CHANNEL_ID`. Right-click yourself → **Copy User ID** → `DISCORD_ADMIN_USER_IDS`.

## 2. Secrets

From `pokepatch-website/` (hosted project; locally these go in `.env.local.prod` and `npm run local` syncs them):

```bash
supabase secrets set DISCORD_PUBLIC_KEY="hex-public-key"
supabase secrets set DISCORD_BOT_TOKEN="bot-token"
supabase secrets set DISCORD_ADMIN_USER_IDS="123456789012345678,anotherUserId"
supabase secrets set DISCORD_QUOTES_CHANNEL_ID="channel-id"   # read by notify
```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected. `verify_jwt = false` is set for `discord-interactions` in `supabase/config.toml` (Discord signs every request with Ed25519).

Normal ship path: merge to `main` → CI deploys all functions. Emergency only: `supabase functions deploy discord-interactions --no-verify-jwt`.

## 3. Interactions Endpoint URL

Discord app → **General Information** → **Interactions Endpoint URL**:

`https://<project-ref>.supabase.co/functions/v1/discord-interactions`

Discord sends a PING; the function answers `{ "type": 1 }`. Save only after verification succeeds.

> Renamed from `discord-photos`. After the first deploy, update the URL above and remove the old function: `supabase functions delete discord-photos` (ask before running — live action).

## 4. Register the `wooper` message command

Buttons need no registration. `wooper` does (once):

```bash
export DISCORD_APP_ID="your-application-id"
export DISCORD_BOT_TOKEN="your-bot-token"
export GUILD_ID="your-server-id"

curl -s -X PUT \
  "https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${GUILD_ID}/commands" \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[{ "name": "wooper", "type": 3 }]'
```

`type: 3` = message command. Drop `/guilds/${GUILD_ID}` for a global command (up to ~1h to appear).

## 5. Pricing + schema

Service keys, list prices, HV tiers and the order-total math are mirrored in [`_shared/servicePricing.ts`](../_shared/servicePricing.ts) from `src/lib/servicePricing.js`; the outreach text + contact link helpers in [`_shared/outreach.ts`](../_shared/outreach.ts) mirror `src/lib/adminOutreachMessage.js` — change the JS file first, then the mirror. Damage tag labels come from [`_shared/damageTags.ts`](../_shared/damageTags.ts).

Save & notify needs the same `RESEND_API_KEY` / `RESEND_FROM_EMAIL` secrets as `admin-api`.

wooper needs migration `card_images_before_after` (`before` / `after` image types).

## 6. Customer + Studio

- Before/after photos are not rendered inline. Customers (My Orders) and admins (order editor) get a **Download before & after** button per card → `order-<n>-card-<i>-<name>.zip` containing `before/` and `after/` folders.
- Admin order card has a **Preview** button (every photo on the card in a modal) and **Open in Studio** when the card has at least one before and one after photo.

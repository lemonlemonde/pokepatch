# Supabase Edge Function: `discord-interactions`

Discord **Interactions Endpoint** for the **quotes** Discord app (separate from wooper).

| Flow | Trigger | File |
|------|---------|------|
| **Quote a card** | **Add quote** / **Edit quote** on a card message in the order thread ([`notify`](../notify/README.md)) | [`quote.ts`](./quote.ts) |
| **Save & notify** / **Refresh** | Buttons on the wrap-up message (last in the thread) | [`notifyCustomer.ts`](./notifyCustomer.ts) |

Before/after photo uploads use a **separate** Discord app → [`discord-photos`](../discord-photos/README.md).

Only Discord user IDs in `DISCORD_ADMIN_USER_IDS` may use these buttons.

---

## Quote a card from Discord

When a customer submits `/quote/`, `notify` posts a header into `DISCORD_QUOTES_CHANNEL_ID`, opens a **thread** (`#42 · Customer`), posts **one message per card**, then a **wrap-up**. Each card message has:

- card name · set, ⭐ if priority
- customer damage tags + description
- every customer photo (media gallery, up to 10)
- current quote (or _not quoted yet_)
- **Add quote** button + **Open in admin** link

Press **Add quote** → modal:

| Field | What it does |
|-------|--------------|
| **Services** (checkboxes) | Surface Cleaning, Minor Damage, Major Damage, Minor Whitening, Major Whitening, Slab Cracking — always list price |
| **Market value (Raw NM, $)** | Sets `cards.market_value_raw_nm`; HV fee from admin tiers ($200–$499 → 4%, $500+ → 8%) |
| **Note to customer** | `cards.admin_note` |

Custom amounts / one-off services stay in the admin order editor.

Submit → `update_order` (same RPC as admin), re-renders the card + wrap-up. When every active card is quoted, the order flips to **pending drop-off**.

Quote lines attach by **name + set** (same as admin).

---

## Wrap-up: contacts, outreach text, Save & notify

Last message in each order thread:

- **Contacts** — phone, Instagram, Discord, email
- **Quote overview** — per-card totals, order total, `n/N` quoted
- **Quote message (copy & paste)** — outreach text in a code block
- **Last notified**
- **Save & notify** · **Refresh** · **Open in admin**

**Save & notify** emails the quote summary via Resend + `customer_messages` (same path as admin). Needs `RESEND_API_KEY` / `RESEND_FROM_EMAIL`.

---

## 1. Create a new Discord application (quotes)

Do **not** reuse the wooper app.

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** (e.g. “PokePatch Quotes”).
2. **Bot** → copy **Token** → `DISCORD_QUOTES_BOT_TOKEN`. Turn off Public Bot if you like.
3. **General Information** → **Public Key** → `DISCORD_QUOTES_PUBLIC_KEY`.
4. **OAuth2 → URL Generator**: scopes `applications.commands` + `bot`; permissions **View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Embed Links, Attach Files, Read Message History**. Invite into the PokePatch server.
5. Developer Mode → right-click the quotes channel → **Copy Channel ID** → `DISCORD_QUOTES_CHANNEL_ID`.

## 2. Secrets

```bash
supabase secrets set DISCORD_QUOTES_PUBLIC_KEY="hex-public-key"
supabase secrets set DISCORD_QUOTES_BOT_TOKEN="bot-token"
supabase secrets set DISCORD_QUOTES_CHANNEL_ID="channel-id"
# Shared allow-list (same as wooper):
# DISCORD_ADMIN_USER_IDS already set
```

`verify_jwt = false` is set for `discord-interactions` in `supabase/config.toml`.

## 3. Interactions Endpoint URL

Quotes app → **General Information** → **Interactions Endpoint URL**:

`https://tmdbqymvjphhfvgyimnb.supabase.co/functions/v1/discord-interactions`

Discord sends a PING; the function answers `{ "type": 1 }`. Save only after verification succeeds.

Keep the **wooper** app pointed at:

`https://tmdbqymvjphhfvgyimnb.supabase.co/functions/v1/discord-photos`

## 4. Pricing mirrors

[`_shared/servicePricing.ts`](../_shared/servicePricing.ts) and [`_shared/outreach.ts`](../_shared/outreach.ts) mirror the frontend JS — edit JS first, then the TS mirror.

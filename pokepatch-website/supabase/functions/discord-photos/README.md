# Supabase Edge Function: `discord-photos`

Discord **Interactions Endpoint** for the **wooper** Discord app only.

| Flow | Trigger | File |
|------|---------|------|
| **wooper** (before/after photos) | Right-click a message with images → **Apps → wooper** | [`wooper.ts`](./wooper.ts) |

Quote requests use a **separate** Discord app → [`discord-interactions`](../discord-interactions/README.md). Instagram carousel PNGs use [`discord-clamperl`](../discord-clamperl/README.md).

Only Discord user IDs in `DISCORD_ADMIN_USER_IDS` may use wooper.

---

## wooper (before/after photos)

1. Post your photos in a Discord channel (up to 10 attachments on one message).
2. **Right-click that message** → **Apps** → **wooper**.
3. Fill in **order number**, **card number** (1 = first card in the order), and optionally **side** (`before` or `after`).

**Own cards:** use order number **`-1`**. That is the permanent owner portfolio (not a customer order). Card slots are created automatically through the card number you enter (`My card 1`, `My card 2`, …). Rename them later under admin → **My cards** tab.

**Side defaults** when left blank:

- Card has no `before` photos → `before`.
- Card has `before` but no `after` → `after`.
- Both sides already have photos → nothing is uploaded; the reply asks you to type `before` or `after` explicitly to replace that side.

Up to **20 photos per side** per card. Files over 15MB are rejected. **Each upload replaces that side** (DB rows + storage); `after` is untouched when uploading `before` and vice versa.

**Status + customer email** (customer orders only — not my-cards `#-1`):

- First **before** photo on a card → card becomes **in progress** (order advances to in progress when it was still earlier in the pipeline) and the customer gets the same changelog-style notify as admin Move & notify (“Your card is now in progress”).
- First **after** photo on a card → card becomes **completed**; when every active card is completed the order becomes **ready for pickup**, and the customer is notified (“…completed” / “ready for pickup”).
- Replacing photos on a card that is already in that status does **not** re-notify.

---

## Setup

1. Use your existing **wooper** Discord application (not the quotes app).
2. **General Information** → **Public Key** → `DISCORD_PUBLIC_KEY` (already set if wooper worked before).
3. **Interactions Endpoint URL**:

   `https://tmdbqymvjphhfvgyimnb.supabase.co/functions/v1/discord-photos`

4. Secrets (shared with the project):

```bash
supabase secrets set DISCORD_PUBLIC_KEY="hex-public-key"
supabase secrets set DISCORD_ADMIN_USER_IDS="123456789012345678"
```

`verify_jwt = false` is set for `discord-photos` in `supabase/config.toml`.

### Register the `wooper` message command (once per app)

```bash
export WOOPER_APP_ID="wooper-application-id"
export WOOPER_BOT_TOKEN="wooper-bot-token"   # only needed to register the command
export GUILD_ID="your-server-id"

curl -s -X PUT \
  "https://discord.com/api/v10/applications/${WOOPER_APP_ID}/guilds/${GUILD_ID}/commands" \
  -H "Authorization: Bot ${WOOPER_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[{ "name": "wooper", "type": 3 }]'
```

`type: 3` = message command.

## Schema

wooper needs `card_images_before_after` (`before` / `after` image types) plus the before→in_progress / after→completed triggers (`cards_in_progress_when_before_photo`, `cards_complete_when_after_photo`). Before→in_progress only runs when the card has no after photos yet — replacing before (or after) on a card that already has both sides is a photo edit only (no status flip, no customer notify).

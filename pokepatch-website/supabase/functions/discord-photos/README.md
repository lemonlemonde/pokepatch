# Supabase Edge Function: `discord-photos`

Discord **Interactions Endpoint** for the **wooper** Discord app only.

| Flow | Trigger | File |
|------|---------|------|
| **wooper** (before/after photos) | Right-click a message with images → **Apps → wooper** | [`wooper.ts`](./wooper.ts) |

Quote requests use a **separate** Discord app → [`discord-interactions`](../discord-interactions/README.md).

Only Discord user IDs in `DISCORD_ADMIN_USER_IDS` may use wooper.

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

wooper needs migration `card_images_before_after` (`before` / `after` image types).

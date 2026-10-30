# Supabase Edge Function: `discord-photos`

Discord **Interactions Endpoint** for uploading restoration before/after photos
onto order cards (`card_images` + private `card-photos` bucket).

## How to use

1. Post your photos in a Discord channel (up to 10 attachments on one message).
2. **Right-click that message** → **Apps** → **wooper**.
3. Fill in **order number**, **card number** (1 = first card in the order), and **side** (`before` or `after`).

Up to **20 photos per side** per card. Files over 15MB are rejected.

Only Discord user IDs listed in `DISCORD_ADMIN_USER_IDS` may run the command.

---

## 1. Discord application (once)

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → Add Bot (needed to register commands).
3. **General Information** → copy **Public Key** → this is `DISCORD_PUBLIC_KEY`.
4. **OAuth2 → URL Generator**: scopes `applications.commands` + `bot`. Invite into your PokePatch Discord server.
5. Copy your Discord user ID (Developer Mode → right-click yourself → Copy User ID) for `DISCORD_ADMIN_USER_IDS`.

---

## 2. Secrets + deploy

From `pokepatch-website/`:

```bash
supabase secrets set DISCORD_PUBLIC_KEY="your-application-public-key-hex"
supabase secrets set DISCORD_ADMIN_USER_IDS="123456789012345678,anotherUserId"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
`verify_jwt = false` is set for `discord-photos` in `supabase/config.toml` (Discord signs the request).

Normal ship path: merge to `main` → CI runs `supabase functions deploy` (all functions).

Emergency only:

```bash
supabase functions deploy discord-photos --no-verify-jwt
```

Function URL shape:

`https://<project-ref>.supabase.co/functions/v1/discord-photos`

---

## 3. Interactions Endpoint URL

In the Discord app → **General Information** → **Interactions Endpoint URL**:

`https://<project-ref>.supabase.co/functions/v1/discord-photos`

Discord sends a PING; the function responds with `{ "type": 1 }`. Save only after verification succeeds.

---

## 4. Register message command `wooper`

Needs the app’s **Application ID** and a bot token (Bot → Reset Token).

Guild command (instant in one server) — replace `GUILD_ID`:

```bash
export DISCORD_APP_ID="your-application-id"
export DISCORD_BOT_TOKEN="your-bot-token"
export GUILD_ID="your-server-id"

curl -s -X PUT \
  "https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${GUILD_ID}/commands" \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "name": "wooper",
      "type": 3
    }
  ]'
```

`type: 3` = message command (right-click a message → Apps).

Global (can take up to ~1 hour):

```bash
curl -s -X PUT \
  "https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands" \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[{ "name": "wooper", "type": 3 }]'
```

---

## 5. Schema prerequisite

Migration `card_images_before_after` adds `before` / `after` to `card_images.image_type`.
Apply via CLI locally / CI `db push` on merge — do not hand-apply DDL on live.

---

## 6. Customer + Studio

- Customers see a **Restoration** block on My Orders: drag-to-compare slider plus Before / After columns (Drive link only if `photos_drive_url` was already set).
- Admin order card shows **Customer photos** and a **Restoration** section with Before / After strips → **Open in Studio** when the card has at least one of each.

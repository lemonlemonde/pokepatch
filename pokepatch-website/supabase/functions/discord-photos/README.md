# Supabase Edge Function: `discord-photos`

Discord **Interactions Endpoint** for uploading restoration before/after photos
onto order cards (`card_images` + private `card-photos` bucket).

Slash command: **`/cardphoto`**

| Option | Type | Meaning |
|--------|------|---------|
| `order` | integer | Order `#` (`orders.display_id`) |
| `card` | integer | **1-based** card index within the order (`sort_order` ascending) |
| `side` | `before` \| `after` | Which album |
| `image1`…`image10` | attachment | Photo files (`image1` required) |

Example: `/cardphoto order:42 card:3 side:after` + attach after photos.

Up to **20 photos per side** per card (before and after each). Files over 15MB are rejected.

Only Discord user IDs listed in `DISCORD_ADMIN_USER_IDS` may run the command.

---

## 1. Discord application (once)

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → Add Bot (optional presence; Interactions URL does not require the bot online).
3. **General Information** → copy **Public Key** → this is `DISCORD_PUBLIC_KEY`.
4. **OAuth2 → URL Generator**: scopes `applications.commands` (+ `bot` if you want the bot user in the server). Invite that URL into your PokePatch Discord server.
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

## 4. Register `/cardphoto`

Needs the app’s **Application ID** and a bot token (Bot → Reset Token).

```bash
export DISCORD_APP_ID="your-application-id"
export DISCORD_BOT_TOKEN="your-bot-token"

curl -s -X PUT \
  "https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands" \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "name": "cardphoto",
      "description": "Upload before/after restoration photos for an order card",
      "options": [
        {
          "name": "order",
          "description": "Order number (display id)",
          "type": 4,
          "required": true
        },
        {
          "name": "card",
          "description": "Card number within the order (1 = first card)",
          "type": 4,
          "required": true
        },
        {
          "name": "side",
          "description": "Before or after album",
          "type": 3,
          "required": true,
          "choices": [
            { "name": "before", "value": "before" },
            { "name": "after", "value": "after" }
          ]
        },
        { "name": "image1", "description": "Photo 1", "type": 11, "required": true },
        { "name": "image2", "description": "Photo 2", "type": 11, "required": false },
        { "name": "image3", "description": "Photo 3", "type": 11, "required": false },
        { "name": "image4", "description": "Photo 4", "type": 11, "required": false },
        { "name": "image5", "description": "Photo 5", "type": 11, "required": false },
        { "name": "image6", "description": "Photo 6", "type": 11, "required": false },
        { "name": "image7", "description": "Photo 7", "type": 11, "required": false },
        { "name": "image8", "description": "Photo 8", "type": 11, "required": false },
        { "name": "image9", "description": "Photo 9", "type": 11, "required": false },
        { "name": "image10", "description": "Photo 10", "type": 11, "required": false }
      ]
    }
  ]'
```

Global commands can take up to ~1 hour to appear; for faster testing, register as a guild command:

`PUT /applications/{app.id}/guilds/{guild.id}/commands`

---

## 5. Schema prerequisite

Migration `card_images_before_after` adds `before` / `after` to `card_images.image_type`.
Apply via CLI locally / CI `db push` on merge — do not hand-apply DDL on live.

---

## 6. Customer + Studio

- Customers see before/after badges on My Orders (Drive link only if `photos_drive_url` was already set).
- Admin order card → **Open in Studio** when the card has at least one before and one after photo.

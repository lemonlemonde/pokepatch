# Supabase Edge Function: `discord-clamperl`

Discord **Interactions Endpoint** for the **clamperl** Discord app.

| Flow | Trigger | File |
|------|---------|------|
| **clamperl** (Instagram carousel PNGs) | Slash command `/clamperl` | [`clamperl.ts`](./clamperl.ts) |

Quotes use [`discord-interactions`](../discord-interactions/README.md). Before/after **uploads** use [`discord-photos`](../discord-photos/README.md) (wooper).

Only Discord user IDs in `DISCORD_ADMIN_USER_IDS` may use `/clamperl`.

---

## `/clamperl` (carousel before/after)

1. `/clamperl order:42` — every card in the order  
   or `/clamperl order:42 card:3` — one card
2. Bot loads before/after photos (sorted by upload id).
3. Skips the first **two** overview pairs on each card.
4. Index-pairs the rest and stitches **lossless 1080×1350 PNG** carousel frames (same 4:5 layout as Admin Studio).
5. Posts each card’s PNG attachments as that card finishes (status message tracks progress).

Cards without enough before/after pairs are skipped with a note in the reply.

---

## Setup

1. Create a **new** Discord application named **clamperl** (separate from wooper / quotes).
2. **General Information** → **Public Key** → `DISCORD_CLAMPERL_PUBLIC_KEY`.
3. **Interactions Endpoint URL**:

   `https://tmdbqymvjphhfvgyimnb.supabase.co/functions/v1/discord-clamperl`

4. Secrets:

```bash
supabase secrets set DISCORD_CLAMPERL_PUBLIC_KEY="hex-public-key"
# DISCORD_ADMIN_USER_IDS already set for wooper/quotes
```

`verify_jwt = false` is set for `discord-clamperl` in `supabase/config.toml`.

### Register the `/clamperl` slash command (once per app)

Re-run this whenever options change (e.g. making `card` optional):

```bash
export CLAMPERL_APP_ID="clamperl-application-id"
export CLAMPERL_BOT_TOKEN="clamperl-bot-token"   # only needed to register the command
export GUILD_ID="your-server-id"

curl -s -X PUT \
  "https://discord.com/api/v10/applications/${CLAMPERL_APP_ID}/commands" \
  -H "Authorization: Bot ${CLAMPERL_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[{
    "name": "clamperl",
    "description": "Generate Instagram carousel before/after PNGs for an order",
    "options": [
      {
        "name": "order",
        "description": "Order number (display id)",
        "type": 4,
        "required": true
      },
      {
        "name": "card",
        "description": "Card number (1 = first). Omit to generate every card.",
        "type": 4,
        "required": false
      }
    ]
  }]'
```

Invite the bot to your server with `applications.commands` scope.

## Notes

- Exports are **PNG** (lossless). Instagram feed max is 1080×1350; Studio’s 6× JPEG supersample is not used here.
- Discord bot attachment limits still apply (~10 MB/file baseline). Oversized PNGs are skipped with a note in the reply.
- First two before/after pairs are treated as overview and never posted.
- Fonts/logo are fetched once per isolate (Nunito via jsDelivr; logo from pokepatch.cards). Edge does not bundle loose `Deno.readFile` assets.

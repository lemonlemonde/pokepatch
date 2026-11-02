# Supabase Edge Function: `discord-clamperl`

Discord **Interactions Endpoint** for the **clamperl** Discord app.

| Flow | Trigger | File |
|------|---------|------|
| **clamperl** (Instagram carousel PNGs) | Slash command `/clamperl` | [`clamperl.ts`](./clamperl.ts) |

Quotes use [`discord-interactions`](../discord-interactions/README.md). Before/after **uploads** use [`discord-photos`](../discord-photos/README.md) (wooper).

Only Discord user IDs in `DISCORD_ADMIN_USER_IDS` may use `/clamperl`.

---

## `/clamperl` (carousel before/after)

1. `/clamperl order:42 card:3` — one card (both options required)
2. Bot loads before/after photos for that card (sorted by upload id).
3. Skips the first **two** overview pairs.
4. Uses the order card’s catalog name / set / thumbnail for the PNG chip (those are required when the order is dragged into To do).
5. Index-pairs the rest and stitches **lossless 1080×1350 PNG** carousel frames — **one pair per Edge worker** — then posts them as Discord attachments and deletes staged files.
6. After Discord delivery, copies those same **source** before/after photos (not the stitch PNGs) into a **published** gallery item, prefilled with the card’s catalog name/set/thumb and order-card damage tags. The status reply includes admin + public gallery links so you can open the item and tweak damage/meta.

Cards without enough before/after pairs get a note in the reply.

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

Re-run this whenever options change:

```bash
export CLAMPERL_APP_ID="clamperl-application-id"
export CLAMPERL_BOT_TOKEN="clamperl-bot-token"   # only needed to register the command

curl -s -X PUT \
  "https://discord.com/api/v10/applications/${CLAMPERL_APP_ID}/commands" \
  -H "Authorization: Bot ${CLAMPERL_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[{
    "name": "clamperl",
    "description": "Generate Instagram carousel before/after PNGs for an order card",
    "options": [
      {
        "name": "order",
        "description": "Order number (display id), or -1 for my cards",
        "type": 4,
        "required": true
      },
      {
        "name": "card",
        "description": "Card number (1 = first in the order)",
        "type": 4,
        "required": true
      }
    ]
  }]'
```

Invite the bot to your server with `applications.commands` scope.

## Notes

- Own cards: pass `order:-1` (same permanent portfolio as wooper). Card index is still 1-based within that order.
- Exports are **PNG** (lossless). Instagram feed max is 1080×1350; Studio’s 6× JPEG supersample is not used here.
- **Why hops:** Supabase Edge Functions cap CPU time per worker (docs say 2s; the worker is killed a few seconds later with `CPU Time exceeded`, and no `catch`/`finally` runs afterwards — Discord just shows a frozen status). Decoding two 6MP phone JPEGs costs ~2.5s CPU, so a multi-pair card cannot finish in one worker. Each hop runs in a fresh worker with a fresh budget.
- **Hop transport:** the job (interaction token, pair paths, staged files) is POSTed to `${SUPABASE_URL}/functions/v1/discord-clamperl` with header `x-clamperl-hop: HMAC-SHA256(body, SUPABASE_SERVICE_ROLE_KEY)`. `index.ts` routes those requests before Discord signature verification; a bad signature is 401. A worker that has already spent >3s of stitch time answers `503` so the dispatcher retries and lands on a fresh isolate. The deferred-interaction token stays valid 15 minutes, which comfortably covers a 10-pair chain.
- Discord gets one follow-up with PNG attachments, then a final status reply (done / gallery links / errors). No per-pair progress spam. Staged Storage objects under `clamperl/<order>/card<n>/<jobId>/` are deleted in a `finally` by the final hop (and on any failure). Each job start also sweeps that scratch prefix for orphans older than ~1h (killed workers), without wiping in-flight concurrent jobs. Uneven before/after counts are called out in the status reply.
- Oversized frames (above the interaction attachment size limit) are skipped with a note in the reply.
- First two before/after pairs are treated as overview and never posted (and are not uploaded to the gallery).
- Gallery publish uses the **source** before/after files for the stitched pairs only — never the carousel PNGs. Status reply links to `/admin/gallery/?item=<id>` (edit) and `/gallery/?item=<id>` (public).
- Fonts/logo are fetched once per isolate (Nunito via jsDelivr; logo from pokepatch.cards). Edge does not bundle loose `Deno.readFile` assets.

# Supabase Edge Function: `discord-clamperl`

Discord **Interactions Endpoint** for the **clamperl** Discord app.

| Flow | Trigger | File |
|------|---------|------|
| **clamperl** (Instagram carousel PNGs) | Slash command `/clamperl` | [`clamperl.ts`](./clamperl.ts) |
| **hop peer** | Internal POST from the other function | [`discord-clamperl-hop`](../discord-clamperl-hop/README.md) |

Quotes use [`discord-interactions`](../discord-interactions/README.md). Before/after **uploads** use [`discord-photos`](../discord-photos/README.md) (wooper).

Only Discord user IDs in `DISCORD_ADMIN_USER_IDS` may use `/clamperl`.

---

## `/clamperl` (carousel before/after)

1. `/clamperl order:42 card:3` — one card (both options required)
2. Bot loads before/after photos for that card (sorted by upload id).
3. Aligns to the last **N** photos on each side (**N** = after count), dropping extra prefix befores when that side is longer, then skips the first **two** of that slice (overview).
4. Uses the order card’s catalog name / set / thumbnail for the PNG chip (those are required when the order is dragged into To do).
5. Index-pairs the rest and stitches **lossless 1080×1350 PNG** carousel frames — **one pair per hop request**.
6. Then gallery-publishes those same **source** before/after photos (not the stitch PNGs) — **one pair per hop request**, including required `.thumb.webp` siblings. Any gallery failure deletes the partial item (no orphan half-published rows).
7. Finally posts Discord PNG attachments, edits the status with an **Edit** admin gallery link, and deletes staged files.

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

`verify_jwt = false` is set for `discord-clamperl` and `discord-clamperl-hop` in `supabase/config.toml`.

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
- **Why hops:** Supabase Edge Functions cap CPU time **per request** (docs say 2s; over that the isolate is killed with `CPU Time exceeded`, and no `catch`/`finally` runs afterwards — Discord just shows a frozen status). Decoding two 6MP phone JPEGs costs ~2.5s CPU, so a multi-pair card cannot finish in one request. Each hop is a new HTTP request with a fresh CPU budget.
- **Hop transport:** the job is POSTed to the **peer** function (`discord-clamperl` ↔ `discord-clamperl-hop`) with header `x-clamperl-hop: HMAC-SHA256(body, SUPABASE_SERVICE_ROLE_KEY)`. A self-POST lands on the same isolate while `waitUntil` is still blocked on `fetch()`, and the next stitch/gallery step gets CPU-killed (PNGs stay in scratch, Discord never gets them). `index.ts` on each function routes hop requests before Discord signature verification; a bad signature is 401. The deferred-interaction token stays valid 15 minutes, which comfortably covers a 10-pair chain.
- After stitch hops, gallery hops copy **one source pair + required thumbs** per hop (same per-request CPU pattern). Then one Discord follow-up with PNG attachments and a Done status with **Edit:**. No per-stitch progress spam (gallery pair N/M only). Staged Storage objects under `clamperl/<order>/card<n>/<jobId>/` are deleted in a `finally` by the final hop (and on any failure). Each job start also sweeps that scratch prefix for orphans older than ~1h (killed workers), without wiping in-flight concurrent jobs. Uneven before/after counts are called out in the status reply.
- Oversized frames (above the interaction attachment size limit) are skipped with a note in the reply.
- Pairing uses the last **N** photos on each side (**N** = after count). Extra prefix befores are dropped, then the first two of that slice are treated as overview and never posted (and are not uploaded to the gallery).
- Gallery publish uses the **source** before/after files for the stitched pairs only — never the carousel PNGs. Thumbs are required; a failed thumb cleans up the whole gallery item. Status reply links to `/admin/gallery/?item=<id>` (Edit). Admin/public UIs do **not** fall back to the full object when a thumb is missing.
- Fonts/logo are fetched once per isolate (Nunito via jsDelivr; logo from pokepatch.cards). Edge does not bundle loose `Deno.readFile` assets.

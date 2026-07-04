# PokePatch

A [Next.js](https://nextjs.org/) + React + Tailwind CSS site for PokePatch card restoration, deployed to GitHub Pages with custom domain **pokepatch.cards**.

## Quick Start

```bash
cd pokepatch-website
npm install
npm run dev
```

Open [http://localhost:3000/pokepatch/](http://localhost:3000/pokepatch/) — the app uses `basePath: /pokepatch` for GitHub Pages.

Copy `.env.local.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Deploy (GitHub Pages)

Repo: `lemonlemonde/pokepatch` → **https://lemonlemonde.github.io/pokepatch/**

```bash
cd pokepatch-website
npm run deploy
```

In the repo **Settings → Pages**, set source to the `gh-pages` branch (root).

**Note:** GitHub Pages runs Jekyll by default, which ignores folders starting with `_` (like `_next`). This project includes a `.nojekyll` file so CSS/JS assets are served correctly.

## Tech Stack

- React / Next.js (static export)
- Tailwind CSS
- Supabase (Postgres, Storage, Edge Functions, Database Webhooks)
- Discord webhooks + Google Sheets (via Apps Script)
- gh-pages

---

## Quote form architecture

The public contact form (`/contact/`) creates a structured **order** with contacts, cards, and photos. Notifications go to Discord and a Google Sheets **Orders** tab.

Legacy submissions still live in `quote_requests` and keep their own notify path. New submissions never write to that table.

### High-level flow

```
Browser (QuoteForm)
  → upload photos to Storage (card-photos/order-{uuid}/card-{uuid}/...)
  → rpc create_order (one transaction)
      → working tables: orders, contacts, cards, card_images
      → original backup: orders_original, contacts_original, ...
  → DB webhook: orders INSERT
  → Edge Function: notify
      → Discord (summary + ORDERS_SHEET_VIEW_URL)
      → Google Sheets Orders tab (via Apps Script)
```

Admin edits later use `update_order` on **working** tables only. Originals are never updated, and admin edits do **not** notify Discord/Sheets.

### Frontend

| Piece | Path |
|-------|------|
| Contact page | `pokepatch-website/src/app/contact/page.js` |
| Quote form | `pokepatch-website/src/components/QuoteForm.js` |
| Supabase client | `pokepatch-website/src/lib/supabaseClient.js` |

Form fields:

- Customer name, delivery method (`local_dropoff` / `shipping`)
- One or more contact methods (phone / Discord / Instagram)
- Up to **10** cards (name, set, description, up to **4** photos each)
- Bulk lots: one card with a lot photo and a combined description

Submit flow (single user action):

1. Generate order + card UUIDs client-side
2. Upload images to `card-photos/order-{orderId}/card-{cardId}/customer-{n}-...`
3. Call `create_order` with the full payload
4. Redirect to `/thank-you`

There is no intermediate save and no `pending` / `submitted` status. The public form only calls `create_order` (never `update_order`).

### Database

Schema lives in:

- [`pokepatch-website/supabase/migrations/20260704000000_orders_schema.sql`](pokepatch-website/supabase/migrations/20260704000000_orders_schema.sql) (apply in SQL Editor)
- [`pokepatch-website/supabase/schema.sql`](pokepatch-website/supabase/schema.sql) (reference docs)

Migration is **additive only**: it does not drop or alter `quote_requests` or historical data.

| Working (admin edits) | Original (immutable backup) |
|-----------------------|----------------------------|
| `orders` | `orders_original` |
| `contacts` | `contacts_original` |
| `cards` | `cards_original` |
| `card_images` | `card_images_original` |

- `orders.id` / `cards.id`: client-generated UUIDs (needed for storage paths before insert)
- `orders.display_id`: bigint identity used in Discord/Sheets (`#42`)
- `orders.general_notes`: admin-only column (not on the public form)
- Same primary keys on original rows as working rows for easy correlation
- Storage files are not duplicated; both working and original image rows share submission-time paths

**RPCs**

| Function | Who | Role |
|----------|-----|------|
| `create_order(p_payload jsonb)` | `anon` | Public form; writes working + original in one transaction |
| `update_order(...)` | `service_role` only | Admin patches to working tables; no notify |

RLS: no direct anon INSERT/SELECT/UPDATE on order tables. Writes go through the RPCs (`SECURITY DEFINER`).

### Storage

- Bucket: `card-photos`
- New paths: `order-{orderUuid}/card-{cardUuid}/customer-{n}-{filename}`
- Legacy paths: `{uuid}/...` (old `quote_requests` photos; left in place)
- Optional policy script: [`pokepatch-website/supabase/storage_policies.sql`](pokepatch-website/supabase/storage_policies.sql) (additive; does not remove existing policies)

### Notifications (`notify` edge function)

Code: [`pokepatch-website/supabase/functions/notify/`](pokepatch-website/supabase/functions/notify/)

Setup details: [`pokepatch-website/supabase/functions/notify/README.md`](pokepatch-website/supabase/functions/notify/README.md)

Dual-mode handler:

| Trigger | Path | Discord | Sheets |
|---------|------|---------|--------|
| `orders` **INSERT** | New orders | `New Order #N` + `ORDERS_SHEET_VIEW_URL` | **Orders** tab via `ORDERS_SHEETS_*` |
| `quote_requests` **INSERT** | Legacy | `New Quote Request #N` + `SHEET_VIEW_URL` | **Requests** tab via `SHEETS_*` |

Contacts formatting: semicolons in Discord, newlines in Sheets.

### Google Sheets / Apps Script

| Artifact | Purpose |
|----------|---------|
| [`scripts/google-sheets-webhook.gs`](pokepatch-website/scripts/google-sheets-webhook.gs) | Legacy **Requests** tab (bound script; leave alone) |
| [`scripts/google-sheets-webhook-orders.gs`](pokepatch-website/scripts/google-sheets-webhook-orders.gs) | **Orders** tab (standalone project + `SPREADSHEET_ID`) |

Google allows only one Apps Script project bound per spreadsheet, so Orders is a **standalone** project at [script.google.com](https://script.google.com) that opens the workbook with `SpreadsheetApp.openById(SPREADSHEET_ID)`.

### Supabase secrets

| Secret | Purpose |
|--------|---------|
| `DISCORD_WEBHOOK_URL` | Shared Discord webhook |
| `SHEETS_WEBHOOK_URL` / `SHEETS_SECRET` / `SHEET_VIEW_URL` | Legacy Requests path — **do not change** |
| `ORDERS_SHEETS_WEBHOOK_URL` | Orders Apps Script `/exec` URL |
| `ORDERS_SHEETS_SECRET` | Must match Orders script `SHARED_SECRET` |
| `ORDERS_SHEET_VIEW_URL` | Discord link to the Orders tab |

### Database webhooks

| Table | Event | Target |
|-------|-------|--------|
| `quote_requests` | Insert | `notify` (keep) |
| `orders` | Insert | `notify` (required for new form) |

Do **not** webhook `orders` UPDATE — admin `update_order` must stay silent.

### Key file map

```
pokepatch-website/
  src/components/QuoteForm.js          # Public quote form
  src/lib/supabaseClient.js
  supabase/
    migrations/…_orders_schema.sql     # Tables + RPCs
    schema.sql                         # Reference docs
    storage_policies.sql               # Optional storage policies
    functions/notify/                  # Discord + Sheets
  scripts/
    google-sheets-webhook.gs           # Legacy Requests
    google-sheets-webhook-orders.gs    # Orders tab
```

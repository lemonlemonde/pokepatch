# PokePatch

A [Next.js](https://nextjs.org/) + React + Tailwind CSS site for PokePatch card restoration, deployed to GitHub Pages with custom domain **pokepatch.cards**.

## Quick Start

```bash
cd pokepatch-website
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.local.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY` (optional — analytics disabled if unset)

## Deploy (GitHub Pages)

Repo: `lemonlemonde/pokepatch` → **https://lemonlemonde.github.io/pokepatch/**

```bash
cd pokepatch-website
npm run deploy
```

In the repo **Settings → Pages**, set source to the `gh-pages` branch (root).

**Note:** GitHub Pages runs Jekyll by default, which ignores folders starting with `_` (like `_next`). This project includes a `.nojekyll` file so CSS/JS assets are served correctly.

**Analytics:** `NEXT_PUBLIC_*` vars (including PostHog) are inlined at build time. Set them in `.env.local` before running `npm run deploy`.

## Tech Stack

- React / Next.js (static export)
- Tailwind CSS
- Supabase (Postgres, Storage, Edge Functions, Database Webhooks)
- Discord webhooks + Google Sheets (via Apps Script)
- PostHog (page analytics + quote form funnel)
- gh-pages

---

## Analytics (PostHog)

[PostHog](https://posthog.com/) tracks page visits, session duration, and quote form conversion. Session replay is disabled.

### Setup

1. Create a PostHog project (US region: `https://us.i.posthog.com`).
2. Add to `.env.local`:
   - `NEXT_PUBLIC_POSTHOG_KEY` — project API key
   - `NEXT_PUBLIC_POSTHOG_HOST` — defaults to `https://us.i.posthog.com` if unset
3. Rebuild and deploy (`npm run deploy`).

Tracking is skipped on `/admin/`. If `NEXT_PUBLIC_POSTHOG_KEY` is unset, analytics are a no-op (safe for local dev).

### Form events

| Event | When |
|-------|------|
| `quote_form_started` | First interaction with any form field |
| `quote_form_step_completed` | `step: customer_info` or `step: card_details` |
| `quote_form_submit_attempted` | Validation passed, upload starting |
| `quote_form_submitted` | `create_order` RPC succeeded |
| `quote_form_error` | Failure (`validation_failed`, `storage_upload_failed`, `supabase_insert_failed`, etc.) |

No PII is sent in event properties.

### Funnel (PostHog dashboard)

Create a funnel under **Product analytics → Funnels**:

1. Pageview where `$current_url` contains `/contact/`
2. `quote_form_started`
3. `quote_form_submit_attempted`
4. `quote_form_submitted`

Optional: **Trends** chart for `quote_form_error` by `error_type`; **Paths** from `/contact/`.

---

## Architecture overview

The site is a **static frontend** on GitHub Pages. All backend logic runs in **Supabase** (Postgres, Storage, Edge Functions).

| Surface | Route | Backend |
|---------|-------|---------|
| Public quote form | `/contact/` | `create_order` RPC + Storage + `notify` |
| Public gallery | `/gallery/` | `gallery_items` SELECT (anon) + public `gallery` bucket |
| Admin orders + gallery + studio | `/admin/` (unlisted) | `admin-auth` + `admin-api` edge functions |
| Legacy quotes | — | `quote_requests` table + `notify` (historical only) |

New customer submissions write to the **orders** relational model. Legacy rows in `quote_requests` are kept for history and still have their own notify path.

---

## Public quote form

The contact form creates a structured **order** with contacts, cards, and photos. On submit, Discord and the Google Sheets **Orders** tab are notified.

### Flow

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
  → redirect to /thank-you
```

There is no intermediate save. The public form only calls `create_order` (never `update_order`).

### Form behavior

- Customer name, delivery method (`local_dropoff` / `shipping`)
- One or more contact methods (phone / Discord / Instagram)
- Up to **10** cards (name, set, description, up to **4** photos each)
- Bulk lots: one card entry with a lot photo and a combined description
- Client generates order + card UUIDs, uploads photos, then calls `create_order` once

### Frontend

| Piece | Path |
|-------|------|
| Contact page | `pokepatch-website/src/app/contact/page.js` |
| Quote form | `pokepatch-website/src/components/QuoteForm.js` |
| Card photo previews | `pokepatch-website/src/components/CardPhotoPreviews.js` |
| Supabase client | `pokepatch-website/src/lib/supabaseClient.js` |

---

## Database

Postgres holds two parallel data paths: **legacy quotes** and **orders**.

### Legacy (read-only for new features)

| Table | Role |
|-------|------|
| `quote_requests` | Flat submissions from the old form; historical data + legacy notify webhook |

### Orders (current)

Each submission creates **working** rows (admin can edit) and matching **original** backup rows (written once, never updated).

| Working (admin edits) | Original (immutable backup) |
|-----------------------|----------------------------|
| `orders` | `orders_original` |
| `contacts` | `contacts_original` |
| `cards` | `cards_original` |
| `card_images` | `card_images_original` |

**`orders`**

| Column | Notes |
|--------|-------|
| `id` | Client-generated UUID |
| `display_id` | Bigint identity — shown in Discord/Sheets as `#42` |
| `customer_name`, `delivery_method` | From public form |
| `general_notes` | Admin-only (not on public form) |
| `status` | Admin kanban: `new`, `in_progress`, `completed`, `delivered` |

**`cards` / `card_images`**

- Card IDs are client-generated UUIDs (storage paths exist before insert)
- `card_images.image_type`: `customer` (form), plus admin types `progress_front`, `progress_back`, `final_front`, `final_back`
- Storage files are not duplicated; working and original image rows share the same paths

**`admin_sessions`**

- Short-lived tokens for `/admin/` login (service role only)

### RPCs

| Function | Caller | Role |
|----------|--------|------|
| `create_order(p_payload jsonb)` | `anon` | Public form; writes working + original in one transaction |
| `update_order(...)` | `service_role` only | Admin edits to working tables; no notify |

RLS: no direct anon SELECT/INSERT/UPDATE on order tables. Public and admin writes go through RPCs or edge functions (`SECURITY DEFINER` / service role).

Schema reference: [`pokepatch-website/supabase/schema.sql`](pokepatch-website/supabase/schema.sql)

---

## Storage

- **Bucket:** `card-photos` (private order photos)
- **New order paths:** `order-{orderUuid}/card-{cardUuid}/customer-{n}-{filename}`
- **Admin photo paths:** `order-{orderUuid}/card-{cardUuid}/{image_type}-{n}-{filename}`
- **Legacy paths:** `{uuid}/...` (old `quote_requests` photos; left in place)
- **Bucket:** `gallery` (public marketing media for `/gallery`)
- **Gallery paths:** `item-{uuid}/pair-{uuid}/{before|after}-{filename}`

---

## Public gallery CMS

Gallery restorations are managed from **`/admin/` → Gallery** (no GitHub image commits).

Each card has a title, set name, damage-tag checklist (`crease`, `scratching`, `dent`, `edge_lift`, `dirt`), and an ordered list of before/after media pairs (images or videos).

### Setup

1. Run gallery migrations in order under [`pokepatch-website/supabase/migrations/`](pokepatch-website/supabase/migrations/) (`20260714000000` … `20260714040000`) in the Supabase SQL Editor.
2. Redeploy `admin-api`:
   ```bash
   cd pokepatch-website
   supabase functions deploy admin-api --no-verify-jwt --project-ref <ref>
   ```
3. (Optional) One-time seed of existing `public/gallery` assets into Supabase:
   ```bash
   # needs SUPABASE_SERVICE_ROLE_KEY in .env.local (service role — never commit)
   node --env-file=.env.local scripts/seed-gallery.mjs
   ```
4. Deploy the static site so the admin Gallery tab and client fetch are live.

Until published rows exist in `gallery_items`, `/gallery` still shows the built-in static assets. Once any published DB row exists, the page uses Supabase only.

### Admin actions (`admin-api`)

| action | Purpose |
|--------|---------|
| `gallery_list` / `gallery_get` | Read items (newest first by `created_at`) |
| `gallery_create` / `gallery_save` | Create / update metadata (title, set, damage tags) |
| `gallery_delete` | Delete item + pairs + storage files |
| `gallery_pair_*` | Create / delete / reorder / clear pair sides |
| multipart `kind=gallery` | Upload before/after media for a pair |

---

## Notifications

Edge function: [`pokepatch-website/supabase/functions/notify/`](pokepatch-website/supabase/functions/notify/)

Operational setup: [`pokepatch-website/supabase/functions/notify/README.md`](pokepatch-website/supabase/functions/notify/README.md)

| Trigger | Discord | Sheets |
|---------|---------|--------|
| `orders` INSERT | `New Order #N` + link to Orders tab | **Orders** tab via `ORDERS_SHEETS_*` |
| `quote_requests` INSERT | `New Quote Request #N` + link to Requests tab | **Requests** tab via `SHEETS_*` |

Contacts formatting: semicolons in Discord, newlines in Sheets.

**Important:** only **INSERT** webhooks are configured. Admin `update_order` must stay silent (no `orders` UPDATE webhook).

### Google Sheets / Apps Script

| Script | Tab |
|--------|-----|
| [`scripts/google-sheets-webhook.gs`](pokepatch-website/scripts/google-sheets-webhook.gs) | Legacy **Requests** (bound to sheet) |
| [`scripts/google-sheets-webhook-orders.gs`](pokepatch-website/scripts/google-sheets-webhook-orders.gs) | **Orders** (standalone Apps Script + `SPREADSHEET_ID`) |

Google allows only one bound script per spreadsheet, so Orders uses a standalone project at [script.google.com](https://script.google.com).

### Supabase secrets

| Secret | Purpose |
|--------|---------|
| `DISCORD_WEBHOOK_URL` | Shared Discord webhook |
| `SHEETS_WEBHOOK_URL` / `SHEETS_SECRET` / `SHEET_VIEW_URL` | Legacy Requests path |
| `ORDERS_SHEETS_WEBHOOK_URL` / `ORDERS_SHEETS_SECRET` / `ORDERS_SHEET_VIEW_URL` | Orders path |
| `ADMIN_PASSWORD` | Admin login (server-side only) |

---

## Admin orders, gallery & studio

Password-gated UI at **`/admin/`** (URL-only — not in the public navbar).

Tabs:

- **Orders** — kanban + order editor
- **Gallery** — create/edit/delete public gallery restorations + media uploads (newest first)
- **Studio** — before & after formatters for Instagram posts: front & back side-by-side, 2×2 grid (pair any number of images into one or more posts), and video

### Flow

```
Browser (/admin)
  → admin-auth (password → session token in sessionStorage)
  → admin-api (X-Admin-Token + service role)
      → read/write working order tables
      → Storage uploads for admin photo types
      → gallery_items CRUD + gallery bucket uploads
  → no notify / Discord / Sheets
```

### UI behavior

- **Kanban** columns: New → In progress → Completed → Delivered
- Drag between columns updates `status` immediately
- Click a card to open the editor; field changes require **Save**
- Staged admin photos upload on Save
- Kanban list loads summaries only; full order detail (with signed photo URLs) loads when a card is opened
- **Gallery** tab lists restorations; Save uploads chosen before/after images and videos to the public `gallery` bucket

### Status values

| DB value | Column |
|----------|--------|
| `new` | New |
| `in_progress` | In progress |
| `completed` | Completed |
| `delivered` | Delivered |

### Edge functions

| Function | Role |
|----------|------|
| [`admin-auth`](pokepatch-website/supabase/functions/admin-auth/) | Login, logout, validate session |
| [`admin-api`](pokepatch-website/supabase/functions/admin-api/) | Orders + gallery list/get/save/delete/upload |

Details: [`pokepatch-website/supabase/functions/admin/README.md`](pokepatch-website/supabase/functions/admin/README.md)

### Frontend

| Piece | Path |
|-------|------|
| Admin page | `pokepatch-website/src/app/admin/` |
| Admin UI | `pokepatch-website/src/components/admin/AdminApp.js` |
| Gallery admin | `pokepatch-website/src/components/admin/GalleryManager.js` |
| Studio tools | `pokepatch-website/src/components/StudioTool.js` |
| API client | `pokepatch-website/src/lib/adminApi.js` |
| Public gallery fetch | `pokepatch-website/src/lib/gallery.js` |

Admin edits use `update_order` on **working** tables only. Original backups and `quote_requests` are never modified.

---

## File map

```
pokepatch-website/
  src/
    app/contact/                 # Public quote page
    app/gallery/                 # Public gallery (loads from Supabase)
    app/admin/                   # Admin page (noindex)
    components/
      QuoteForm.js               # Public quote form
      GalleryContent.js          # Gallery lightbox + cards
      PostHogProvider.jsx        # PostHog init + pageviews
      CardPhotoPreviews.js       # Shared card photo thumbnails
      admin/AdminApp.js          # Kanban + order editor + gallery + studio tabs
      admin/GalleryManager.js    # Gallery CMS
      StudioTool.js              # Before/after formatters (front & back, 2×2 grid, video)
      StudioPairBoard.js         # Grid formatter image bank + before/after pairing UI
    lib/
      supabaseClient.js          # Public Supabase client
      gallery.js                 # Public gallery fetch + fallbacks
      posthog.js                 # PostHog init + capture helper
      adminApi.js                # Admin edge function client
  supabase/
    schema.sql                   # Schema reference
    migrations/
      20260714000000_gallery_items.sql
    functions/
      notify/                    # Discord + Sheets on INSERT
      admin-auth/
      admin-api/
  scripts/
    seed-gallery.mjs             # One-time upload of public/gallery → Supabase
    google-sheets-webhook.gs     # Legacy Requests tab
    google-sheets-webhook-orders.gs  # Orders tab
```

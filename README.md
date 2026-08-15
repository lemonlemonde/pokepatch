# PokePatch

A [Next.js](https://nextjs.org/) + React + Tailwind CSS site for PokePatch card restoration, deployed to GitHub Pages with custom domain **pokepatch.cards**.

## Quick Start (local full stack)

Branch work should hit a **local** Supabase stack (DB + edge functions) so you can test end-to-end without deploying or pushing migrations to live.

One-time setup (single env file — no separate Supabase env copy):

```bash
cd pokepatch-website
npm install
cp .env.local.example .env.local.prod
# edit .env.local.prod: NEXT_PUBLIC_* plus any edge secrets you want locally
# (DISCORD_WEBHOOK_URL, ADMIN_ALLOWED_EMAILS / NEXT_PUBLIC_ADMIN_ALLOWED_EMAILS, Resend, Sheets, …)
```

Daily — only this:

```bash
cd pokepatch-website
npm run local
```

That starts Supabase (if needed), syncs edge secrets from `.env.local.prod` into the local function runtime, retargets order/quote INSERT triggers at **local** `notify` (so Discord/Sheets don’t hit production), points the app at the local API, and runs Next.js.

Open [http://localhost:3000](http://localhost:3000). Studio is usually at [http://127.0.0.1:54323](http://127.0.0.1:54323).

Submit a quote on `/contact/` → local DB → local `notify` → Discord (if `DISCORD_WEBHOOK_URL` is in `.env.local.prod`).

New schema on a branch: `supabase migration new <name>`, edit the file, then `supabase db reset` and `npm run local` again. Remote apply happens when the PR merges (CI `db push`).

### Switching between local stack and hosted project

`npm run local` / `npm run devenv` point at the local stack. `npm run prodenv` points at the **hosted** project (same DB as live — useful only for quick UI checks against production data; do not rely on it for unpushed migrations or undeployed functions).

```bash
cd pokepatch-website
npm run devenv   # local stack already running → next dev
npm run prodenv  # hosted project → next dev
sh scripts/use-env.sh dev|prod   # switch symlink without starting the server
readlink .env.local              # which env is active
```

`.env.local` is a symlink; the real values live in `.env.local.prod`. `.env.local.dev` is regenerated from it on every local switch, swapping only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for what the running stack reports — everything else (PostHog, admin emails, feature flags) stays identical. All three files are gitignored.

Local auth emails (signup confirmation, password recovery) don't leave the machine — they go to the local mail catcher. `supabase start` prints its URL if one is running; `supabase/config.toml` has no `[inbucket]` block, so enable it there if the emails don't show up.

## Deploy (CI on merge)

Repo: `lemonlemonde/pokepatch` → **https://pokepatch.cards** (GitHub Pages via `gh-pages`).

**Normal path:** merge (or push) to `main`. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) ships in order:

1. Schema — `supabase db push`
2. Edge functions — `supabase functions deploy` (all functions; JWT flags from `supabase/config.toml`)
3. Frontend — Next.js static export → `gh-pages` branch

See [Local vs live (deploy safety)](#local-vs-live-deploy-safety). Merging to `main` **is** the go-live action.

### One-time GitHub Actions secrets

Repo **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|--------|---------|
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token |
| `SUPABASE_PROJECT_ID` | Project ref |
| `SUPABASE_DB_PASSWORD` | Database password (for `db push`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend build |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Frontend build |
| `NEXT_PUBLIC_POSTHOG_KEY` | Frontend build (optional) |
| `NEXT_PUBLIC_POSTHOG_HOST` | Frontend build (optional) |
| `NEXT_PUBLIC_ADMIN_ALLOWED_EMAILS` | Frontend build (if used) |
| `NEXT_PUBLIC_CUSTOMER_AUTH_ENABLED` | Frontend build (if used) |

Edge-function **runtime** secrets (`ADMIN_ALLOWED_EMAILS`, Resend, Discord, Sheets, …) stay in the Supabase project dashboard; CI only redeploys function code.

In **Settings → Pages**, source should be the `gh-pages` branch (root). `.nojekyll` is written by CI so `_next` assets are served correctly.

### Manual frontend publish (emergency only)

```bash
cd pokepatch-website
npm run deploy
```

Uses `.env.local.prod` via `use-env.sh prod`. Prefer fixing/re-running the Actions workflow instead.

## Tech Stack

- React / Next.js (static export)
- Tailwind CSS
- Supabase (Postgres, Storage, Edge Functions, Database Webhooks)
- Discord webhooks + Google Sheets (via Apps Script)
- PostHog (page analytics + quote form funnel)
- gh-pages

---

## Notion → Cursor tickets

Use Notion as the task backlog and the repo Cursor skill to plan/implement work.

### 1. Notion MCP

Add to `~/.cursor/mcp.json` (merge into existing `mcpServers` if you already have that file):

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\": \"Bearer secret_your_notion_token_here\", \"Notion-Version\": \"2022-06-28\" }"
      }
    }
  }
}
```

Replace `secret_your_notion_token_here` with a Notion integration token that can access the **Tasks** database. Restart Cursor / reload MCP after editing.

### 2. Skill: `lets-do-notion-tickets`

Repo skill: [`.cursor/skills/lets-do-notion-tickets/`](.cursor/skills/lets-do-notion-tickets/).

In Cursor, invoke **lets-do-notion-tickets** (or “lets do notion tickets”). Cursor will propose solutions for every task whose Status is **Not started** or **Up next** on Notion’s Tasks page (always reading each task description first). Iterate on the plan, then tell it which tickets to execute.

### 3. Lifecycle tags and PRs

While executing:

- Cursor sets **Cursor-owned** to **🐭 in progress** (and Status to **In progress**) when work on a ticket’s branch starts.
- When the branch work is ready for review, Cursor sets **Cursor-owned** to **🐭 needs review** (Status stays **In progress**).
- A PR link is **appended** at the end of the task description (append-only; existing body is not rewritten).

### 4. Review

- Test each change locally against the PR / ticket checklist.
- Fork the Cursor chat as needed for follow-up fixes on a ticket without mixing unrelated work.

---

## Analytics (PostHog)

[PostHog](https://posthog.com/) tracks page visits, session duration, and quote form conversion. Session replay is disabled.

### Setup

1. Create a PostHog project (US region: `https://us.i.posthog.com`).
2. Add to `.env.local.prod` (and the matching GitHub Actions secret for CI builds):
   - `NEXT_PUBLIC_POSTHOG_KEY` — project API key
   - `NEXT_PUBLIC_POSTHOG_HOST` — defaults to `https://us.i.posthog.com` if unset
3. Merge to `main` so CI rebuilds the site (or emergency `npm run deploy`).

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

## Local vs live (deploy safety)

Work stays **local by default**. Local edits (frontend, edge functions, migration files) do not affect production until they land on `main`. Live is three surfaces shipped together by CI:

| Surface | Local (working copy) | Live (production) | How it goes live |
|---------|----------------------|-------------------|------------------|
| **Frontend** | `npm run local` / `npm run devenv` | GitHub Pages (`pokepatch.cards`) | CI on push to `main` (manual `npm run deploy` = emergency only) |
| **Edge functions** | Served by local `supabase start` | Deployed Supabase functions (`admin-api`, `notify`, …) | CI `supabase functions deploy` on `main` |
| **Schema** | Applied by local `supabase start` / `db reset` | Remote Postgres + `schema_migrations` | CI `supabase db push` on `main` |

On a feature branch, use `npm run local` so all three stay in sync locally. Mixing **local frontend + hosted API** (`npm run prodenv`) is possible but skips unpushed migrations and undeployed functions.

### Default rules

1. **Keep changes on a branch** and test with `npm run local` until the user merges (or asks to merge) to `main`.
2. **Merging to `main` is the ship** — CI runs schema → functions → frontend. Do not also manually `db push` / `functions deploy` / `npm run deploy` after a merge unless CI failed and the user wants an emergency fallback.
3. **Never** run live-affecting commands without asking first, including:
   - `supabase functions deploy …`
   - `supabase db push` / remote DDL (dashboard SQL, MCP `apply_migration`, etc.)
   - `git push` to `main` / merging a PR to `main`
   - Manual `npm run deploy` / `gh-pages`
4. **Agents must not** manually publish after merge (CI owns that). Exception: **`/reset-main`** still may publish frontend if that skill requires it, or the user explicitly asks for a manual emergency deploy in that message.
5. Before asking to merge or manually go live, **give a short deploy impact analysis** (see below).

### Deploy impact analysis (required before any live action)

Say clearly **what is going live** and **what stays local**, then answer:

| Audience | Questions to answer |
|----------|---------------------|
| **Customers** (public site, quote form, gallery, thank-you, My Orders) | Will anything break, error, or change behavior if only this surface goes live? |
| **Admins** (`/admin/`) | Same — board, editor, gallery CMS, studio, messaging. |

Also call out **cross-version risk** when surfaces are not shipped together:

| If you deploy… | While this is still old… | Typical risk |
|----------------|--------------------------|--------------|
| Edge function (additive: new action / optional fields) | Old frontend | Usually **safe** — old client never calls the new path |
| Edge function (changed/removed response shape or existing action) | Old frontend | **Can break** admins or customers still on the old client |
| Frontend that requires new API fields/actions | Old edge function | **Can break** the new UI until the function is deployed |
| Schema that existing API/frontend assume is already live | Old API or old frontend | **Can break** both; coordinate or make migrations backward-compatible |
| Schema only (local migration not pushed) | — | Live unchanged; local/dev may not match production data shape |

**Example:** deploying an additive `admin-api` `search` action while production frontend has no search UI → **not broken**. Deploying a frontend that calls `search` before that function is deployed → **admin search broken**.

### Suggested ship order

CI on `main` always applies **schema → edge functions → frontend**. Prefer backward-compatible migrations and additive API changes in the same PR so a single merge is safe. If you must split across PRs, ship schema/API before UI that depends on them.

Schema CLI workflow details: [Schema changes (CLI-managed)](#schema-changes-cli-managed).

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
| `status` | Admin kanban: `pending` (Pending), `new` (To do), `in_progress`, `completed`, `canceled` |
| `pending_kind` | When `pending`: `quote` or `drop_off` (Pending quote / Pending drop-off chips) |

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

Schema reference (informational, may lag live): [`pokepatch-website/supabase/schema.sql`](pokepatch-website/supabase/schema.sql)

### Schema changes (CLI-managed)

Live production is the baseline. Historical migration files were cleared once; from then on, **local files and remote `schema_migrations` must stay in lockstep**. That truncation is why `20260721000000_baseline_from_live.sql` exists — it is a `supabase db dump` of the live schema, timestamped ahead of every other migration, so the directory can build a database from scratch. It is recorded as already-applied on the hosted project, so `db push` never runs it there. Don't edit it; new changes go in new migrations as usual. The CLI keys each migration by the **timestamp prefix in the filename**, not by SQL content — mismatched names = “dirty” history even if the DB already looks correct.

Writing a migration file is local only. Applying it to the **hosted** project is a live action — normally done by CI on merge to `main` (`db push`). Manual `db push` / remote DDL only as emergency fallback with permission — see [Local vs live (deploy safety)](#local-vs-live-deploy-safety).

To try a migration before merge, use the local stack: `npm run local` (or `supabase start`) applies every file under `supabase/migrations/`. After adding a migration while the stack is already up, run `supabase db reset` or `supabase migration up`.

#### Happy path (preferred)

```bash
cd pokepatch-website
supabase migration new <short_name> # creates supabase/migrations/<timestamp>_<short_name>.sql
# edit only that new file (delta only)
npm run local                       # or: supabase db reset — exercise locally
# open PR → merge to main → CI runs supabase db push
supabase migration list             # optional check that Local === Remote after CI
```

#### Rules

- Put **only the delta** in each new migration (never re-apply the whole live schema).
- **Always** create files with `supabase migration new`. Never invent or rename migration timestamps by hand.
- Do **not** apply schema via the Supabase dashboard SQL editor, MCP `apply_migration`, or ad-hoc `execute_sql` for DDL **unless** you immediately sync local afterward (see below). Prefer merge-to-`main` CI (or emergency `db push` with permission).
- Keep `schema.sql` as a human reference if useful; it is not what the CLI applies.
- Before committing migration changes, run `supabase migration list` against the linked project when you can, and fix any Local/Remote mismatch.

#### If something was applied on remote first (MCP / dashboard)

Do **not** also create a differently named local file for the same change. Sync local from live history:

```bash
cd pokepatch-website
supabase migration fetch --linked   # writes/updates files to match remote versions
supabase migration list             # Local and Remote columns should align
```

If you already added a wrong local filename, delete or replace it so versions match remote, then commit the aligned files. Do not `db push` a duplicate under a new timestamp.

#### Sanity check

```bash
supabase migration list
```

Every row should show the **same version** in both Local and Remote. Any version only on one side means history is dirty — fix that before the next schema change.

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

Gallery tables, storage, and RLS are already on live. For future gallery schema/API/UI changes, use CLI migrations + branch PRs; merge to `main` so CI ships schema → functions → frontend — see [Schema changes (CLI-managed)](#schema-changes-cli-managed) and [Deploy (CI on merge)](#deploy-ci-on-merge).

Optional one-time seed of existing `public/gallery` assets into Supabase:

```bash
# needs SUPABASE_SERVICE_ROLE_KEY in .env.local (service role — never commit)
cd pokepatch-website
node --env-file=.env.local scripts/seed-gallery.mjs
```

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
- **Studio** — 1×2 before & after photo formatter for Instagram posts (Before-After and Front-Back pair modes)

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
      StudioTool.js              # 1×2 before/after photo formatter
      StudioFolderBoard.js       # Before/after folder uploads + manual pairing
    lib/
      supabaseClient.js          # Public Supabase client
      gallery.js                 # Public gallery fetch + fallbacks
      posthog.js                 # PostHog init + capture helper
      adminApi.js                # Admin edge function client
  supabase/
    schema.sql                   # Schema reference (may lag live)
    migrations/                  # CLI deltas; versions must match remote (see Schema changes)
    functions/
      notify/                    # Discord + Sheets on INSERT
      admin-auth/
      admin-api/
  scripts/
    seed-gallery.mjs             # One-time upload of public/gallery → Supabase
    google-sheets-webhook.gs     # Legacy Requests tab
    google-sheets-webhook-orders.gs  # Orders tab
```

# AGENTS.md

## Cursor Cloud specific instructions

### Project layout
- This repo contains a single product, **PokePatch**, a Next.js 16 (App Router, static export) marketing + ops site. All app code lives under `pokepatch-website/`. Run all `npm` commands from that directory.
- Package manager is **npm** (`package-lock.json`). Node 22 is available and works with Next.js 16.

### Running / building
- Dev server: `cd pokepatch-website && npm run dev` (Turbopack) → http://localhost:3000. See `README.md` for the standard quick start.
- Production/static build: `npm run build` (outputs static `out/` via `output: "export"`).
- Standard scripts live in `pokepatch-website/package.json`.

### Linting caveat (non-obvious)
- `npm run lint` is **broken**: it runs `next lint`, which was removed in Next.js 16, so `next` treats `lint` as a directory arg and fails.
- The committed `eslint.config.mjs` also fails: its `FlatCompat`-wrapped `next/core-web-vitals` is incompatible with `eslint-config-next` 16's native flat config (ESLint throws `Converting circular structure to JSON`).
- To actually run ESLint, use the native flat config directly, e.g. a temporary config that does `import next from "eslint-config-next/core-web-vitals"; export default [...next]` and run `npx eslint . --config <that-file>`. This surfaces pre-existing lint errors in the repo source (e.g. `react-hooks/set-state-in-effect`) which are unrelated to environment setup.

### Backend / Supabase (non-obvious)
- There is **no local backend, database, or docker-compose**. All backend logic (Postgres, Storage, Edge Functions, webhooks) runs in a **hosted Supabase** project. There is no local Supabase config (`supabase/config.toml`) to run.
- Without `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `pokepatch-website/.env.local` (copy from `.env.local.example`):
  - The public quote form (`/contact/`) renders and is fully interactive, but the **Submit button is intentionally disabled** and a "Form setup needed" banner shows.
  - The admin panel and gallery CMS (`/admin/`, gated by the `admin-auth`/`admin-api` edge functions) cannot log in.
  - `/gallery/` falls back to the built-in static assets in `public/gallery/`.
- The marketing site, the interactive quote form (everything except final submit), and the static gallery fallback are fully testable locally with no secrets.
- Full end-to-end flows (order submit → DB → Discord/Sheets, admin, Supabase-backed gallery) require a configured hosted Supabase project with migrations applied, edge functions deployed, storage buckets/policies, webhooks, and notification secrets — see `README.md`. PostHog is optional and a no-op if `NEXT_PUBLIC_POSTHOG_KEY` is unset.

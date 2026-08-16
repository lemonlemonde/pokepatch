#!/bin/sh
# Boot the full local stack (Supabase + Next.js) for branch development.
# No remote db push, functions deploy, or site publish.
#
#   npm run local
#
# Prerequisites:
#   - Docker running
#   - .env.local.prod with hosted NEXT_PUBLIC_* values (and optional edge
#     secrets like DISCORD_WEBHOOK_URL / ADMIN_ALLOWED_EMAILS — see
#     .env.local.example). One file; no separate supabase/.env copy step.
set -eu
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the local Supabase stack" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running — start Docker Desktop first" >&2
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI not found — install it, then retry" >&2
  exit 1
fi

if [ ! -f .env.local.prod ]; then
  if [ -f .env.local ] && [ ! -L .env.local ]; then
    echo "moving .env.local → .env.local.prod (one-time)"
    mv .env.local .env.local.prod
  else
    echo "missing .env.local.prod — copy .env.local.example and fill values:" >&2
    echo "  cp .env.local.example .env.local.prod" >&2
    exit 1
  fi
fi

# Edge secrets for local functions (Discord, admin gate, Resend, …).
prev_env_hash=""
if [ -f supabase/.env ]; then
  prev_env_hash="$(cksum supabase/.env | awk '{print $1" "$2}')"
fi
sh scripts/sync-local-edge-env.sh
new_env_hash="$(cksum supabase/.env | awk '{print $1" "$2}')"

if ! supabase status >/dev/null 2>&1; then
  echo "starting local Supabase (applies all migrations)…"
  supabase start
elif [ "$prev_env_hash" != "$new_env_hash" ]; then
  echo "supabase/.env changed — restarting local stack so edge secrets reload…"
  supabase stop
  supabase start
else
  echo "local Supabase already running"
fi

# Baseline migration points INSERT webhooks at hosted notify; retarget every boot.
sh scripts/retarget-local-notify-triggers.sh

sh scripts/use-env.sh dev

eval "$(supabase status -o env | sed 's/^/SB_/')"

echo ""
echo "Local stack ready (nothing deployed to live):"
echo "  Next.js   http://localhost:3000"
echo "  API       ${SB_API_URL:-http://127.0.0.1:54321}"
echo "  Studio    ${SB_STUDIO_URL:-http://127.0.0.1:54323}"
if [ -n "${SB_INBUCKET_URL:-}" ]; then
  echo "  Mail      $SB_INBUCKET_URL"
fi
echo ""
echo "Quote submit → local notify (Discord if DISCORD_WEBHOOK_URL is in .env.local.prod)."
echo "New migrations: supabase migration new <name>, then supabase db reset && npm run local"
echo ""

npm run dev

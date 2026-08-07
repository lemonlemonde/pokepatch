#!/bin/sh
# Point .env.local at either the hosted Supabase project or a local
# `supabase start` stack.
#
#   npm run prodenv    # hosted project, then `next dev`
#   npm run devenv     # local stack, then `next dev`
#
# Run this script directly to switch without starting the dev server.
#
# .env.local becomes a symlink; the real values live in .env.local.prod. The
# dev file is regenerated from the prod one on every switch, with only the
# Supabase URL and key swapped for whatever the running local stack reports —
# so PostHog, admin emails, and feature flags stay identical between the two.
set -eu
cd "$(dirname "$0")/.."

usage() {
  echo "usage: scripts/use-env.sh prod|dev" >&2
  exit 1
}

if [ ! -f .env.local.prod ]; then
  echo "missing .env.local.prod — move your hosted-project .env.local there first:" >&2
  echo "  mv .env.local .env.local.prod" >&2
  exit 1
fi

case "${1:-}" in
  prod)
    ln -sf .env.local.prod .env.local
    ;;
  dev)
    if ! supabase status >/dev/null 2>&1; then
      echo "local Supabase stack isn't running — run 'supabase start' first" >&2
      exit 1
    fi
    # `supabase status -o env` prints API_URL, ANON_KEY, and friends. Prefix
    # them so they can't collide with anything already in the shell.
    eval "$(supabase status -o env | sed 's/^/SB_/')"
    sed -e "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$SB_API_URL|" \
        -e "s|^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=.*|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SB_ANON_KEY|" \
        .env.local.prod > .env.local.dev
    ln -sf .env.local.dev .env.local
    ;;
  *)
    usage
    ;;
esac

echo "env.local -> $(readlink .env.local)"

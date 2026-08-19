#!/usr/bin/env bash
#
# Forge deployment script for Goliath Dispatch (Next.js).
#
# Point Forge's deploy script at this file so the deployment recipe lives in
# version control and changes go through review, rather than living only in the
# Forge UI where nothing records why it changed:
#
#     cd $FORGE_SITE_PATH && bash deploy/forge/deploy.sh
#
# Enable "Quick Deploy" on the site's Apps tab and Forge installs a GitHub
# webhook, so every push to the deployment branch runs this.
#
# ── On Forge's "Zero Downtime Deployment" ────────────────────────────────────
# This script works with it on or off, but off is recommended for a Node app:
#
#   • PM2 already replaces workers one at a time (`pm2 reload`, cluster mode),
#     so requests are not dropped during a deploy either way.
#   • With zero-downtime on, Forge flips the `current` symlink *after* this
#     script finishes — so nothing here can restart the app against the new
#     release. The reload below would restart the *previous* one.
#   • Every release gets its own `node_modules` and `.next`. That is well over
#     a gigabyte per deploy, and it accumulates.
#
# When it is on, Forge has already cloned the code, so the fetch below is
# skipped automatically.

set -Eeuo pipefail

SITE_PATH="${FORGE_SITE_PATH:-$(pwd)}"
BRANCH="${FORGE_SITE_BRANCH:-main}"

cd "$SITE_PATH"

# Forge's zero-downtime mode clones into releases/<id> and hands us a tree that
# is already at the right commit. Pulling there is at best redundant and at
# worst rewinds a detached checkout.
if [[ "$SITE_PATH" == *"/releases/"* ]]; then
  echo "▸ Zero-downtime release detected — Forge already placed the code"
elif git rev-parse --git-dir > /dev/null 2>&1 && git remote get-url origin > /dev/null 2>&1; then
  echo "▸ Fetching ${BRANCH}"
  git fetch --prune origin "$BRANCH"
  git reset --hard "origin/${BRANCH}"
else
  echo "▸ Not a git working tree with an origin remote — skipping fetch"
fi

echo "▸ Installing dependencies"
# `npm ci` — an exact, reproducible install from package-lock.json. Never
# `npm install` on a server: it can silently resolve a different tree than the
# one that passed CI.
npm ci --no-audit --no-fund

echo "▸ Applying database migrations"
# Runs before the build so the new code never starts against an old schema.
# Migrations here are additive by convention; a destructive change is applied
# manually, in a maintenance window, not by an automatic deploy.
npm run db:migrate

echo "▸ Building"
npm run build

echo "▸ Reloading the application"
mkdir -p storage/logs

if [[ "$SITE_PATH" == *"/releases/"* ]]; then
  # The symlink has not flipped yet, so reloading now would point PM2 at the
  # outgoing release. Leave a marker the post-activation hook picks up.
  echo "  (zero-downtime mode: run 'pm2 reload goliath-dispatch' after activation)"
else
  if pm2 describe goliath-dispatch > /dev/null 2>&1; then
    pm2 reload ecosystem.config.js --update-env
  else
    pm2 start ecosystem.config.js
    pm2 save
  fi

  echo "▸ Warming the home page"
  # Fails the deploy loudly if the app cannot actually serve a request, instead
  # of reporting success and leaving a broken site up.
  for attempt in $(seq 1 10); do
    if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:${PORT:-3000}/en/home"; then
      echo "✓ Deployment complete"
      exit 0
    fi
    echo "  waiting for the server to answer (${attempt}/10)…"
    sleep 3
  done

  echo "✗ The application did not answer after the reload. Check: pm2 logs goliath-dispatch"
  exit 1
fi

echo "✓ Deployment complete"

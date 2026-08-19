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

set -Eeuo pipefail

SITE_PATH="${FORGE_SITE_PATH:-$(pwd)}"
BRANCH="${FORGE_SITE_BRANCH:-main}"

cd "$SITE_PATH"

echo "▸ Fetching ${BRANCH}"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

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
if pm2 describe goliath-dispatch > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
  pm2 save
fi

echo "▸ Warming the home page"
# Fails the deploy loudly if the app cannot actually serve a request, instead of
# reporting success and leaving a broken site up.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:${PORT:-3000}/en/home"; then
    echo "✓ Deployment complete"
    exit 0
  fi
  echo "  waiting for the server to answer (${attempt}/10)…"
  sleep 3
done

echo "✗ The application did not answer after the reload. Check: pm2 logs goliath-dispatch"
exit 1

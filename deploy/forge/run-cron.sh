#!/usr/bin/env bash
#
# Replacement for Vercel Cron.
#
# `vercel.json` declares eight schedules. Nothing outside Vercel reads that
# file, so on Forge the same endpoints have to be driven by the system cron.
# This script is what each scheduled job calls; it reads CRON_SECRET from the
# site's .env so the token is never written into a crontab line (crontabs are
# world-readable on most systems).
#
# Usage:  bash deploy/forge/run-cron.sh <job-name>
# Jobs:   drain | fmcsa-reverification | document-expiration | invoice-overdue
#         retention-archive | retention-purge | tracking-ingest
#         tracking-link-expiry

set -Eeuo pipefail

JOB="${1:?usage: run-cron.sh <job-name>}"
SITE_PATH="${FORGE_SITE_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PORT="${PORT:-3000}"

cd "$SITE_PATH"

if [[ ! -f .env ]]; then
  echo "✗ No .env at ${SITE_PATH}; cannot read CRON_SECRET" >&2
  exit 1
fi

# Read only the one variable, without sourcing the whole file — .env holds
# values with characters that would be re-interpreted by the shell.
CRON_SECRET="$(grep -E '^CRON_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')"

if [[ -z "${CRON_SECRET}" ]]; then
  echo "✗ CRON_SECRET is empty in ${SITE_PATH}/.env" >&2
  exit 1
fi

STATUS="$(curl -sS -o /tmp/goliath-cron-${JOB}.out -w '%{http_code}' \
  --max-time 300 \
  -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://127.0.0.1:${PORT}/api/cron/${JOB}")"

if [[ "${STATUS}" != "200" ]]; then
  echo "✗ ${JOB} returned HTTP ${STATUS}" >&2
  cat "/tmp/goliath-cron-${JOB}.out" >&2 || true
  exit 1
fi

echo "✓ ${JOB}: $(cat /tmp/goliath-cron-${JOB}.out | head -c 400)"

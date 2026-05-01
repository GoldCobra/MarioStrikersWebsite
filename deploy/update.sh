#!/usr/bin/env bash
# Mario Strikers Community Website — redeploy / update script
#
# Run this whenever you upload a new version of the project.
# Must be run from the project root on the server, or pass the path as argument.
#
# Usage (on server):
#   cd /var/www/msc && sudo ./deploy/update.sh
set -euo pipefail

SITE_DIR="${1:-/var/www/msc}"   # override by passing a path: ./update.sh /custom/path

echo ""
echo "=== Mario Strikers — Updating ==="
echo "Site dir: $SITE_DIR"
echo ""

# ── 1. Sync files (skip secrets and generated dirs) ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Only sync if running locally (source != destination)
if [ "$PROJECT_ROOT" != "$SITE_DIR" ]; then
  echo "[1/3] Copying updated files..."
  rsync -a --delete \
    --exclude='backend/node_modules' \
    --exclude='backend/.env' \
    --exclude='deploy/logs' \
    "$PROJECT_ROOT/" "$SITE_DIR/"
else
  echo "[1/3] Running on server — skipping rsync (files already in place)."
fi

# ── 2. Install / update backend dependencies ──────────────────────────────────
echo "[2/3] Updating backend dependencies..."
cd "$SITE_DIR/backend"
npm install --production

# ── 3. Reload API (zero-downtime) ─────────────────────────────────────────────
echo "[3/3] Reloading API..."
pm2 reload msc-api

echo ""
echo "=== Update complete ==="
echo ""
echo "  Check status : pm2 status"
echo "  Live logs    : pm2 logs msc-api --lines 50"
echo "  Health check : curl http://127.0.0.1:8787/api/health"
echo ""

#!/usr/bin/env bash
# Mario Strikers Community Website — first-time server setup
#
# Run this once on your Linux server (as root or with sudo).
# Assumes: Debian/Ubuntu, Nginx already installed, domain DNS pointing to this server.
#
# Usage:
#   chmod +x deploy/setup.sh
#   sudo ./deploy/setup.sh
set -euo pipefail

# ─── Edit these two values before running ──────────────────────────────────────
DOMAIN="your-domain.com"     # e.g. mariostrikerscommunity.com  (no www prefix)
SITE_DIR="/var/www/msc"      # where the project lives on the server
# ───────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo ""
echo "=== Mario Strikers — Server Setup ==="
echo "Domain   : $DOMAIN"
echo "Site dir : $SITE_DIR"
echo "Source   : $PROJECT_ROOT"
echo ""

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[1/6] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  NODE_VER=$(node --version)
  echo "[1/6] Node.js already installed ($NODE_VER) — skipping."
fi

# ── 2. PM2 ────────────────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "[2/6] Installing PM2..."
  npm install -g pm2
else
  echo "[2/6] PM2 already installed — skipping."
fi

# ── 3. Copy project files ─────────────────────────────────────────────────────
echo "[3/6] Copying project files to $SITE_DIR..."
mkdir -p "$SITE_DIR"
rsync -a --delete \
  --exclude='backend/node_modules' \
  --exclude='backend/.env' \
  --exclude='deploy/logs' \
  "$PROJECT_ROOT/" "$SITE_DIR/"
mkdir -p "$SITE_DIR/deploy/logs"

# ── 4. Backend dependencies + .env ────────────────────────────────────────────
echo "[4/6] Installing backend dependencies..."
cd "$SITE_DIR/backend"
npm install --production

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────┐"
  echo "  │  ACTION REQUIRED: fill in your credentials in:             │"
  echo "  │    $SITE_DIR/backend/.env"
  echo "  │                                                             │"
  echo "  │  Set CORS_ORIGIN=https://$DOMAIN                          │"
  echo "  │  Set MSSQL_HOST, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD│"
  echo "  └─────────────────────────────────────────────────────────────┘"
  echo ""
  read -r -p "  Press Enter after you have saved .env to continue..." _
fi

# ── 5. Nginx virtual host ─────────────────────────────────────────────────────
echo "[5/6] Configuring Nginx..."
NGINX_CONF=/etc/nginx/sites-available/msc
cp "$SITE_DIR/deploy/nginx.conf" "$NGINX_CONF"
sed -i "s/YOUR_DOMAIN/$DOMAIN/g"   "$NGINX_CONF"
sed -i "s|/var/www/msc|$SITE_DIR|g" "$NGINX_CONF"

if [ ! -L /etc/nginx/sites-enabled/msc ]; then
  ln -s "$NGINX_CONF" /etc/nginx/sites-enabled/msc
fi

nginx -t
systemctl reload nginx
echo "  Nginx configured for $DOMAIN."

# ── 6. PM2 start ──────────────────────────────────────────────────────────────
echo "[6/6] Starting API with PM2..."
cd "$SITE_DIR"
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true  # run the generated startup command

echo ""
echo "=== Setup complete ==="
echo ""
echo "What's left:"
echo "  • HTTPS:  certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo "  • Check:  pm2 status"
echo "  • Logs:   pm2 logs msc-api"
echo "  • Health: curl https://$DOMAIN/api/health"
echo ""

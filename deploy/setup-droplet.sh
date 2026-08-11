#!/usr/bin/env bash
# One-time provisioning for a fresh Ubuntu droplet. Run manually over SSH as a
# sudo-capable user, then hand ongoing deploys to the GitHub Actions workflow.
set -euo pipefail

REPO_URL="git@github.com:<org>/<repo>.git"   # fill in
APP_DIR="/opt/lisi-api"
BRANCH="main"

sudo apt-get update
sudo apt-get install -y curl nginx git

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo npm install -g pm2

sudo mkdir -p "$APP_DIR" /etc/lisi
sudo chown "$USER":"$USER" "$APP_DIR"

git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
cd "$APP_DIR/functions"
npm ci
npm run build

echo "Now:"
echo "1. Copy your Firebase service account key to /etc/lisi/service-account.json"
echo "2. Copy functions/.env.example to functions/.env and fill in real values"
echo "3. pm2 start ecosystem.config.js"
echo "4. pm2 save && pm2 startup (follow the printed systemd instructions)"
echo "5. Configure Nginx using deploy/nginx.conf as a template, then:"
echo "   sudo certbot --nginx -d api.yourdomain.com"

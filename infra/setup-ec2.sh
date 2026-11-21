#!/usr/bin/env bash
# One-time setup for the Locus API + call worker on a fresh Ubuntu 24.04 EC2 instance (ap-south-1).
# Run as the default `ubuntu` user:  bash infra/setup-ec2.sh api.yourdomain.in
set -euo pipefail
DOMAIN="${1:?usage: setup-ec2.sh <api domain, e.g. api.locus.example>}"

sudo apt-get update
sudo apt-get install -y ffmpeg git curl debian-keyring debian-archive-keyring apt-transport-https
# Node 22 + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable && corepack prepare pnpm@10.13.1 --activate
# Caddy (automatic HTTPS)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# App: expects the repo at ~/Locus and the production .env at ~/Locus/.env (never committed).
cd ~/Locus
pnpm install --frozen-lockfile
pnpm --filter @locus/api db:migrate

sed "s/{{API_DOMAIN}}/$DOMAIN/" infra/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo cp infra/systemd/locus-api.service infra/systemd/locus-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now locus-api locus-worker
sudo systemctl reload caddy
echo "Done. Check: curl -s https://$DOMAIN/me (expect 401), journalctl -u locus-api -u locus-worker -f"

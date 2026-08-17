#!/usr/bin/env bash
# Install the HexaLLM systemd units + timers. Run once as root:
#   sudo deploy/systemd/install.sh
#
# Installs the dual-engine inference stack:
#   hexallm-vllm.service     — vLLM serving the fast 7B tier (claims VRAM first)
#   ollama.service           — native ollama for the heavy tiers (boots AFTER vLLM)
#   hexallm-warmup.service   — preloads both engines' resident models
#   hexallm-backend.service  — FastAPI backend (routes 7B → vLLM, rest → ollama)
#   hexallm-tunnel.service   — cloudflared tunnel
#   hexallm-backup.timer, hexallm-monitor.timer
set -euo pipefail

cd "$(dirname "$0")"

cp hexallm-vllm.service ollama.service hexallm-warmup.service \
   hexallm-backend.service hexallm-tunnel.service \
   hexallm-backup.service hexallm-backup.timer \
   hexallm-monitor.service hexallm-monitor.timer /etc/systemd/system/

cp hexallm-warmup.sh /usr/local/bin/hexallm-warmup.sh
chmod +x /usr/local/bin/hexallm-warmup.sh

systemctl daemon-reload

# Boot order is load-bearing: vLLM must claim its VRAM budget before ollama
# loads any model, and the warmup must run after both.
systemctl enable --now hexallm-vllm.service ollama.service
systemctl enable hexallm-warmup.service

systemctl enable --now hexallm-backend.service

# Replace the old token-based tunnel with the config-as-code one.
systemctl disable --now cloudflared.service || true
systemctl enable --now hexallm-tunnel.service

systemctl enable --now hexallm-backup.timer hexallm-monitor.timer

echo "✅ Installed: hexallm-vllm, ollama, hexallm-warmup, hexallm-backend, hexallm-tunnel, hexallm-backup.timer, hexallm-monitor.timer"
echo "   Old cloudflared.service stopped and disabled."
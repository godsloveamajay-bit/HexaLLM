#!/usr/bin/env bash
# Install the HexaLLM systemd units + timers. Run once as root:
#   sudo deploy/systemd/install.sh
set -euo pipefail

cd "$(dirname "$0")"

cp hexallm-tunnel.service hexallm-backup.service hexallm-backup.timer \
   hexallm-monitor.service hexallm-monitor.timer /etc/systemd/system/

systemctl daemon-reload

# Replace the old token-based tunnel with the config-as-code one.
systemctl disable --now cloudflared.service || true
systemctl enable --now hexallm-tunnel.service

systemctl enable --now hexallm-backup.timer hexallm-monitor.timer

echo "✅ Installed: hexallm-tunnel.service, hexallm-backup.timer, hexallm-monitor.timer"
echo "   Old cloudflared.service stopped and disabled."

#!/usr/bin/env bash
# Uptime monitor — hits the public health endpoint of every env and logs to
# journald. Run hourly via the hexallm-monitor.timer. (For email/Slack alerts,
# drop a notifier after the logger line.)
set -uo pipefail

LOG=/home/hexallm/hexallm-monitor.log
for host in ai.hexallm.co.uk dev.hexallm.co.uk; do
  if ! curl -fsS --max-time 20 "https://$host/api/v1/health" >/dev/null 2>&1; then
    msg="[$(date -Is)] DOWN: $host"
    echo "$msg" >> "$LOG"
    logger -t hexallm-monitor "$msg"
  fi
done

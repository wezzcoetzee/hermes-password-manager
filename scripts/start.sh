#!/usr/bin/env bash
# Start AgentVault: Docker services, then the native helper LaunchAgent.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$root" && docker compose up -d --wait)
if [[ "$(uname)" == "Darwin" ]]; then
  launchctl kickstart "gui/$(id -u)/dev.agentvault.helper" 2>/dev/null \
    || launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.agentvault.helper.plist"
fi
echo "AgentVault started"

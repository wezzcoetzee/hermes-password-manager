#!/usr/bin/env bash
# Stop AgentVault. The broker closes every browser session on SIGTERM; nothing survives a stop.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$root" && docker compose --profile dev stop)
if [[ "$(uname)" == "Darwin" ]]; then
  launchctl bootout "gui/$(id -u)/dev.agentvault.helper" 2>/dev/null || true
fi
echo "AgentVault stopped"

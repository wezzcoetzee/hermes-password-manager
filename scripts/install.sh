#!/usr/bin/env bash
# AgentVault installer for macOS. Safe to re-run: every step checks before it acts.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
home="${AGENTVAULT_HOME:-$HOME/.agentvault}"
app="$home/bin/AgentVaultHelper.app"
helper_bin="$app/Contents/MacOS/AgentVaultHelper"
plist="$HOME/Library/LaunchAgents/dev.agentvault.helper.plist"
say() { printf '\n==> %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Missing $1. $2" >&2; exit 1; }; }

[[ "$(uname)" == "Darwin" ]] || { echo "install.sh targets macOS. On Linux see README (dev helper)." >&2; exit 1; }
need docker "Install Docker Desktop and enable 'Start Docker Desktop when you sign in'."
need node "Install Node.js 24 or newer."
need swift "Install Xcode Command Line Tools: xcode-select --install"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { echo "Node 24+ required" >&2; exit 1; }

say "Installing Node dependencies"
(cd "$root" && { corepack enable >/dev/null 2>&1 || true; } && corepack pnpm install --frozen-lockfile)

say "Creating the broker/worker shared secret"
umask 077
mkdir -p "$root/secrets" "$home/bin" "$home/logs"
[[ -s "$root/secrets/worker_token" ]] || openssl rand -hex 32 > "$root/secrets/worker_token"

say "Building the native helper"
swift build -c release --package-path "$root/native/AgentVaultHelper"
mkdir -p "$app/Contents/MacOS"
cp "$root/native/AgentVaultHelper/.build/release/AgentVaultHelper" "$helper_bin"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.agentvault.helper</string>
  <key>CFBundleName</key><string>AgentVault</string>
  <key>CFBundleExecutable</key><string>AgentVaultHelper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
# Keychain ACLs trust the signing identity. Ad-hoc by default; set AGENTVAULT_SIGN_IDENTITY to a
# Developer ID so rebuilds keep Keychain access without re-prompting.
codesign --force --sign "${AGENTVAULT_SIGN_IDENTITY:--}" "$app"

say "Starting Docker services"
(cd "$root" && docker compose up -d --build --wait)

if [[ ! -s "$home/agent-token" ]]; then
  say "Creating the hermes agent identity"
  (cd "$root" && AGENTVAULT_HELPER="$helper_bin" node src/cli/main.ts agent add hermes)
fi

say "Pairing the broker with the native helper (confirm the prompt and Touch ID)"
(cd "$root" && AGENTVAULT_HELPER="$helper_bin" node src/cli/main.ts pair)

say "Installing the LaunchAgent"
mkdir -p "$(dirname "$plist")"
sed -e "s#__HELPER_BIN__#$helper_bin#" -e "s#__LOG_DIR__#$home/logs#" "$root/scripts/launchd/dev.agentvault.helper.plist" > "$plist"
launchctl bootout "gui/$(id -u)/dev.agentvault.helper" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"

say "Linking the agentvault CLI"
cat > "$home/bin/agentvault" <<CLI
#!/usr/bin/env bash
cd "$root" && AGENTVAULT_HELPER="$helper_bin" exec "$(command -v node)" "$root/src/cli/main.ts" "\$@"
CLI
chmod +x "$home/bin/agentvault"

say "Connecting Hermes"
node_bin="$(command -v node)"
if command -v hermes >/dev/null && ! grep -q '^  agentvault:' "$HOME/.hermes/config.yaml" 2>/dev/null; then
  hermes mcp add agentvault --command "$node_bin" --args "$root/src/mcp-adapter/main.ts" \
    --env "AGENTVAULT_BROKER_URL=http://127.0.0.1:7800" --env "AGENTVAULT_TOKEN_FILE=$home/agent-token"
  hermes config set mcp_servers.agentvault.timeout 200 || true
else
  echo "Add this to ~/.hermes/config.yaml (or Hermes Desktop > Settings > MCP):"
  sed -e "s#__NODE__#$node_bin#" -e "s#__ROOT__#$root#" -e "s#__HOME__#$home#" "$root/hermes/config.example.yaml"
fi

mkdir -p "$HOME/.hermes/skills/agentvault" && cp "$root/hermes/SKILL.md" "$HOME/.hermes/skills/agentvault/SKILL.md"

cat <<DONE

AgentVault is installed. Next:
  export PATH="$home/bin:\$PATH"
  agentvault credential add <account-id> --site <site-id>   # password goes into a native dialog
  agentvault grant <account-id> [--transactions]
DONE

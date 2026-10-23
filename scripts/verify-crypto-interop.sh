#!/usr/bin/env bash
# Proves the Swift helper's protocol crypto (native/.../Crypto.swift) interoperates with the broker's
# (src/shared/crypto.ts), using swift-crypto in a Linux container. Runs anywhere Docker runs.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp -R "$root/test/interop/swift/." "$work/pkg"
cp "$root/native/AgentVaultHelper/Sources/AgentVaultHelper/Crypto.swift" "$work/pkg/Sources/Interop/"
mkdir -p "$work/io"
node "$root/test/interop/crypto-interop.ts" fixture "$work/io"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work/pkg:/pkg" -v "$work/io:/io" -w /pkg swift:5.10-jammy \
  bash -c 'swift build -q -c release 2>&1 | tail -20 && .build/release/Interop /io'
node "$root/test/interop/crypto-interop.ts" check "$work/io"

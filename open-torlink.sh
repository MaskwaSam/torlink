#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Finder-launched Terminal sessions do not always inherit Homebrew's paths.
# Keep the user's environment first, then add the standard macOS tool paths.
TORLINK_TOOL_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}:$TORLINK_TOOL_PATH"

pause_on_error() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo
    echo "TorLink could not start. Press Return to close this window."
    read -r _
  fi
  exit "$code"
}
trap pause_on_error EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run TorLink."
  echo "Install it from https://nodejs.org/ and try again."
  exit 1
fi

if ! command -v transmission-daemon >/dev/null 2>&1; then
  echo "Transmission's CLI backend is required."
  echo "Install with: brew install transmission-cli"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing TorLink dependencies..."
  npm install
fi

if [[ ! -f dist/cli.cjs ]]; then
  echo "Building TorLink..."
  npm run build
fi

node dist/cli.cjs

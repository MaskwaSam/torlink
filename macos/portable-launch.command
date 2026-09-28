#!/bin/bash
set -euo pipefail

RESOURCES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="$RESOURCES/bin/node"
TORLINK="$RESOURCES/app/dist/cli.cjs"

pause_on_error() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    echo
    echo "TorLink could not start. Press Return to close this window."
    read -r _
  fi
  exit "$status"
}
trap pause_on_error EXIT

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This TorLink package is for an Apple-silicon Mac."
  echo "An Intel build is required for this computer."
  exit 1
fi

if [[ ! -x "$NODE" || ! -f "$TORLINK" ]]; then
  echo "TorLink.app is incomplete. Copy it again from the original ZIP."
  exit 1
fi

export PATH="$RESOURCES/bin:/usr/bin:/bin:/usr/sbin:/sbin"
"$NODE" "$TORLINK"

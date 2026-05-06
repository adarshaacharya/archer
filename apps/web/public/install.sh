#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="@adarshaacharya/archer"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install Archer." >&2
  echo "Install Node.js 18+ and try again." >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" && "$(uname -s)" != "Linux" ]]; then
  echo "Unsupported operating system: $(uname -s)" >&2
  echo "Archer currently supports macOS, Linux, and WSL." >&2
  exit 1
fi

echo "Installing Archer from npm..."
npm install -g "$PACKAGE_NAME"

echo
echo "Archer is installed."
echo "Run: archer --help"

#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="@adarshaacharya/archer"
OS_NAME="$(uname -s)"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install Archer." >&2
  echo "Install Node.js 18+ and try again." >&2
  exit 1
fi

if [[ "$OS_NAME" != "Darwin" && "$OS_NAME" != "Linux" ]]; then
  echo "Unsupported operating system: $OS_NAME" >&2
  echo "Archer currently supports macOS, Linux, and WSL." >&2
  exit 1
fi

echo "Installing Archer from npm..."
if ! npm install -g "$PACKAGE_NAME"; then
  echo >&2
  echo "Archer could not be installed from npm." >&2
  echo "Check that your npm account can access $PACKAGE_NAME and that npm is configured correctly." >&2
  echo "If the problem continues, try: npm view $PACKAGE_NAME version" >&2
  exit 1
fi

echo
echo "Archer is installed."
echo "Run: archer --help"

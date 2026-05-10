#!/usr/bin/env bash
set -euo pipefail

OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
INSTALL_DIR="${ARCHER_INSTALL_DIR:-$HOME/.local/share/archer}"
BIN_DIR="${ARCHER_BIN_DIR:-$HOME/.local/bin}"
VERSION="${ARCHER_VERSION:-latest}"
REPO_SLUG="${ARCHER_REPO:-adarshaacharya/archer}"

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required to install Archer." >&2
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_CMD=(curl -fsSL)
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_CMD=(wget -qO-)
else
  echo "curl or wget is required to install Archer." >&2
  exit 1
fi

case "$OS_NAME" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *)
  echo "Unsupported operating system: $OS_NAME" >&2
  echo "Archer currently supports macOS, Linux, and WSL." >&2
  exit 1
  ;;
esac

case "$ARCH_NAME" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *)
  echo "Unsupported architecture: $ARCH_NAME" >&2
  echo "Archer currently ships arm64 and x64 binaries." >&2
  exit 1
  ;;
esac

archive_name="archer-${os}-${arch}.tar.gz"
if [[ "$VERSION" == "latest" ]]; then
  download_url="https://github.com/${REPO_SLUG}/releases/latest/download/${archive_name}"
else
  download_url="https://github.com/${REPO_SLUG}/releases/download/${VERSION}/${archive_name}"
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$INSTALL_DIR"

echo "Downloading ${archive_name}..."
"${DOWNLOAD_CMD[@]}" "$download_url" >"$tmp_dir/$archive_name"

echo "Installing Archer into $INSTALL_DIR..."
tar -xzf "$tmp_dir/$archive_name" -C "$tmp_dir"

extracted_dir="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "$extracted_dir" || ! -f "$extracted_dir/archer" ]]; then
  echo "Downloaded archive did not contain an Archer binary." >&2
  exit 1
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -R "$extracted_dir"/. "$INSTALL_DIR"/

mkdir -p "$BIN_DIR"
cat >"$BIN_DIR/archer" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export ARCHER_INSTALL_DIR="$INSTALL_DIR"
exec "$INSTALL_DIR/archer" "\$@"
EOF
chmod +x "$BIN_DIR/archer"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
  echo >&2
  echo "Add $BIN_DIR to your PATH to run Archer from new shells." >&2
  echo "For zsh: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc" >&2
  ;;
esac

echo
echo "Archer is installed."
echo "Run: archer --help"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${CODEX_USAGE_INSTALL_DIR:-$HOME/.codex-usage-tracker}"
BIN_DIR="${CODEX_USAGE_BIN_DIR:-$HOME/.local/bin}"

"${ROOT_DIR}/scripts/package.sh"

rm -rf "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
cp -R "${ROOT_DIR}/dist/." "${INSTALL_DIR}/"

mkdir -p "${BIN_DIR}"
ln -sf "${INSTALL_DIR}/codex-track" "${BIN_DIR}/codex-track"

echo "Installed codex-track:"
echo "  Binary: ${BIN_DIR}/codex-track"
echo "  Bundle: ${INSTALL_DIR}"
echo "Run: codex-track web"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo "Note: ${BIN_DIR} is not on your PATH."
    ;;
esac

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${CODEX_USAGE_INSTALL_DIR:-$HOME/.codex-usage-tracker}"

pick_bin_dir() {
  if [[ -n "${CODEX_USAGE_BIN_DIR:-}" ]]; then
    echo "${CODEX_USAGE_BIN_DIR}"
    return
  fi

  local preferred
  preferred=(
    "$HOME/.local/bin"
    "$HOME/bin"
    "/opt/homebrew/bin"
    "/usr/local/bin"
  )

  for dir in "${preferred[@]}"; do
    if [[ "${dir}" == "$HOME/"* && ! -d "${dir}" ]]; then
      mkdir -p "${dir}"
    fi
    if [[ -d "${dir}" && -w "${dir}" ]]; then
      echo "${dir}"
      return
    fi
  done

  IFS=":" read -r -a path_entries <<< "${PATH:-}"
  for dir in "${path_entries[@]}"; do
    [[ -z "${dir}" ]] && continue
    case "${dir}" in
      *"/.codex/tmp/"*|*"/tmp/"*|*"/var/folders/"*|*"/codex.system/bootstrap/"*)
        continue
        ;;
    esac
    if [[ -d "${dir}" && -w "${dir}" ]]; then
      echo "${dir}"
      return
    fi
  done

  mkdir -p "$HOME/.local/bin"
  echo "$HOME/.local/bin"
}

BIN_DIR="$(pick_bin_dir)"

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

resolved="$(command -v codex-track || true)"
if [[ -n "${resolved}" && "${resolved}" != "${BIN_DIR}/codex-track" ]]; then
  echo "Warning: another codex-track is earlier on your PATH:"
  echo "  ${resolved}"
  echo "Update your PATH or remove the older binary if you want the new UI."
fi

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo "Note: ${BIN_DIR} is not on your PATH."
    ;;
esac

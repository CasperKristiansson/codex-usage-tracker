#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui"
DIST_DIR="${ROOT_DIR}/dist"

if [ ! -d "${UI_DIR}" ]; then
  echo "UI directory not found at ${UI_DIR}" >&2
  exit 1
fi

if [ ! -d "${UI_DIR}/node_modules" ]; then
  pnpm --dir "${UI_DIR}" install
fi

pnpm --dir "${UI_DIR}" build

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

mkdir -p "${DIST_DIR}/src"
cp -R "${ROOT_DIR}/src/codex_usage_tracker" "${DIST_DIR}/src/"

mkdir -p "${DIST_DIR}/ui"
cp -R "${UI_DIR}/.next/standalone" "${DIST_DIR}/ui/standalone"
mkdir -p "${DIST_DIR}/ui/standalone/.next"
cp -R "${UI_DIR}/.next/static" "${DIST_DIR}/ui/standalone/.next/static"
if [ -d "${UI_DIR}/public" ]; then
  cp -R "${UI_DIR}/public" "${DIST_DIR}/ui/standalone/public"
fi

cat > "${DIST_DIR}/codex-track" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONPATH="${ROOT_DIR}/src${PYTHONPATH:+:${PYTHONPATH}}"
export CODEX_USAGE_UI_DIST="${ROOT_DIR}/ui"
export CODEX_USAGE_BACKEND_ROOT="${ROOT_DIR}"
exec "${PYTHON:-python}" -m codex_usage_tracker.cli "$@"
EOF

chmod +x "${DIST_DIR}/codex-track"

echo "Packaged build ready:"
echo "  ${DIST_DIR}/codex-track ui"

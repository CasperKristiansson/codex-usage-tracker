#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui"
DIST_DIR="${ROOT_DIR}/dist"
NODE_BIN="$(command -v node)"

if [ ! -d "${UI_DIR}" ]; then
  echo "UI directory not found at ${UI_DIR}" >&2
  exit 1
fi

if [ ! -d "${UI_DIR}/node_modules" ]; then
  pnpm --dir "${UI_DIR}" install
fi

pnpm --dir "${UI_DIR}" rebuild better-sqlite3

sqlite_binding=$(find "${UI_DIR}/node_modules/.pnpm" -path "*better-sqlite3*/**/better_sqlite3.node" -print -quit || true)
if [ -z "${sqlite_binding}" ]; then
  echo "better-sqlite3 native binding not found after rebuild." >&2
  echo "Attempting a clean reinstall to compile native bindings..." >&2
  pnpm --dir "${UI_DIR}" install --force
  pnpm --dir "${UI_DIR}" rebuild better-sqlite3
  sqlite_binding=$(find "${UI_DIR}/node_modules/.pnpm" -path "*better-sqlite3*/**/better_sqlite3.node" -print -quit || true)
  if [ -z "${sqlite_binding}" ]; then
    echo "better-sqlite3 native binding still missing." >&2
    echo "Make sure you have Xcode Command Line Tools installed and are using a supported Node version (LTS recommended)." >&2
    echo "If you use nvm: nvm use 22 && rm -rf ui/node_modules && pnpm --dir ui install" >&2
    exit 1
  fi
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

cat > "${DIST_DIR}/codex-track" <<EOF
#!/usr/bin/env bash
set -euo pipefail

SOURCE="\${BASH_SOURCE[0]}"
while [ -L "\${SOURCE}" ]; do
  DIR="\$(cd -P "\$(dirname "\${SOURCE}")" && pwd)"
  SOURCE="\$(readlink "\${SOURCE}")"
  [[ "\${SOURCE}" != /* ]] && SOURCE="\${DIR}/\${SOURCE}"
done
ROOT_DIR="\$(cd -P "\$(dirname "\${SOURCE}")" && pwd)"
export PYTHONPATH="\${ROOT_DIR}/src\${PYTHONPATH:+:\${PYTHONPATH}}"
export CODEX_USAGE_UI_DIST="\${ROOT_DIR}/ui"
export CODEX_USAGE_BACKEND_ROOT="\${ROOT_DIR}"
export CODEX_USAGE_NODE="${NODE_BIN}"
exec "\${PYTHON:-python}" -m codex_usage_tracker.cli "\$@"
EOF

chmod +x "${DIST_DIR}/codex-track"

echo "Packaged build ready:"
echo "  ${DIST_DIR}/codex-track ui"

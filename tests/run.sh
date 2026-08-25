#!/usr/bin/env bash
# KEEL simulation suite: builds the extension and runs 10 scenario simulations against it.
# Usage: ./tests/run.sh [runs]   (default 1; use 3 to confirm stability)
set -euo pipefail
cd "$(dirname "$0")/.."
RUNS="${1:-1}"
command -v node >/dev/null || { echo "node is required"; exit 1; }
echo "building extension -> tests/keel.mjs"
npx --yes esbuild@0.23 agent/extensions/keel.ts --format=esm --outfile=tests/keelhook.mjs >/dev/null
sed -i.bak 's/^  hook as default$/  hook as default,\n  hook/' tests/keelhook.mjs && rm -f tests/keelhook.mjs.bak
fail=0
# Сверка каждой механики с ОФИЦИАЛЬНОЙ документацией omp (истина - каталог docs/ клона).
if [ -d "${OMP_SRC:-/home/claude/omp-src}/docs" ]; then
  echo; echo "=== сверка с документацией omp ==="
  bash tests/doc-conformance.sh "${OMP_SRC:-/home/claude/omp-src}" | tail -1 || fail=1
fi
# Строгий аудит РЕАЛЬНОГО установленного дерева (не симуляция): парсит каждый файл его настоящим
# парсером и проверяет, что каждая ссылка разрешается. Требует установленный харнесс.
if [ -d "${OMP_AGENT_DIR:-$HOME/.omp/agent}" ] && command -v python3 >/dev/null; then
  echo; echo "=== аудит установленного дерева ==="
  python3 tests/audit-real.py "${OMP_AGENT_DIR:-$HOME/.omp/agent}" . || fail=1
fi
for i in $(seq 1 "$RUNS"); do
  echo; echo "=== run $i/$RUNS ==="
  node tests/suite.mjs || fail=1
  node tests/suite2.mjs || fail=1
  node tests/suite3.mjs || fail=1
  node tests/suite4.mjs || fail=1
  node tests/suite5.mjs || fail=1
  node tests/suite6.mjs || fail=1
  node tests/suite7.mjs || fail=1
  node tests/debug20.mjs || fail=1
  node tests/debug40.mjs || fail=1
  node tests/debug60.mjs || fail=1
done
exit $fail

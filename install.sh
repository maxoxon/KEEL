#!/usr/bin/env bash
# KEEL (omp) installer. Pure ASCII so it renders cleanly everywhere, Windows included.
set -u
OMP="${OMP_AGENT_DIR:-$HOME/.omp/agent}"

line(){ printf '+------------------------------------------------------------+\n'; }
head(){ line; printf '|  KEEL  -  autonomous coding harness for omp                 |\n'; line; }
ok(){   printf '  [ ok ] %s\n' "$1"; }
skip(){ printf '  [skip] %s (exists; merge by hand)\n' "$1"; }
step(){ printf '\n  %s\n' "$1"; }

copy(){ # src dst
  if [ -e "$2" ] && ! cmp -s "$1" "$2"; then skip "$2"; else mkdir -p "$(dirname "$2")"; cp "$1" "$2" && ok "$2"; fi
}

head
if [ -z "${OMP_AGENT_DIR:-}" ] && [ -z "${HOME:-}" ]; then
  printf '\n  [!] HOME is empty and OMP_AGENT_DIR is not set - refusing to write to "/.omp".\n'
  printf '      Set OMP_AGENT_DIR to your real path and re-run, e.g.\n'
  printf '      OMP_AGENT_DIR="C:/Users/<you>/.omp/agent" ./install.sh\n\n'
  exit 1
fi

# KEEL depends on omp. Install the official runtime only when it is missing.
step "checking omp"
if command -v omp >/dev/null 2>&1; then
  ok "omp found: $(command -v omp)"
else
  printf '  omp was not found. Installing the official omp distribution...\n'
  if ! command -v curl >/dev/null 2>&1; then
    printf '  [FAIL] curl is required to install omp. Install curl, then re-run.\n'
    exit 1
  fi
  if ! curl -fsSL https://omp.sh/install | sh; then
    printf '  [FAIL] official omp installer failed. KEEL was not installed.\n'
    exit 1
  fi
  [ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v omp >/dev/null 2>&1; then
    printf '  [FAIL] omp installation completed but "omp" is not on PATH.\n'
    printf '         Open a new terminal (or add the omp install directory to PATH), then re-run.\n'
    exit 1
  fi
  ok "omp installed: $(command -v omp)"
fi

printf '\n  Target: %s\n' "$OMP"
mkdir -p "$OMP/agents" "$OMP/extensions" "$OMP/skills"

step "settings"
copy agent/config.yml "$OMP/config.yml"
copy agent/models.yml "$OMP/models.yml"

step "instructions"
copy agent/AGENTS.md        "$OMP/AGENTS.md"
copy agent/APPEND_SYSTEM.md "$OMP/APPEND_SYSTEM.md"
copy agent/RULES.md         "$OMP/RULES.md"

step "agents"
for f in agent/agents/*.md; do copy "$f" "$OMP/agents/$(basename "$f")"; done

step "skills"
# One level only: ~/.omp/agent/skills/<name>/SKILL.md - omp does not discover nested groups.
for d in agent/skills/*/; do
  n=$(basename "$d")
  [ -f "$d/SKILL.md" ] || continue
  copy "$d/SKILL.md" "$OMP/skills/$n/SKILL.md"
done

step "extension + mcp"
copy agent/extensions/keel.ts "$OMP/extensions/keel.ts"
copy agent/mcp.json           "$OMP/mcp.json"

printf '\n'
line
printf '|  Files copied. Now finish setup (see INSTALL.md):           |\n'
printf '|    1. exact model ids in config.yml + agents/coder.md       |\n'
printf '|    2. language servers (pyright / tsserver / vue)           |\n'
printf '|    3. browser MCP command in mcp.json                       |\n'
printf '|    4. run ./verify.sh (or verify.ps1) - must be 0 failed     |\n'
printf '|  Dashboard:  omp stats     Live agents:  Alt+A (Agent Hub)  |\n'
line
printf '\n'

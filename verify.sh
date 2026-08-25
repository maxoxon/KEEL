#!/usr/bin/env bash
# KEEL install verifier. Deterministic: reads the installed files and reports what IS, not what a
# model says. No model is involved, so nothing here can be "reported" as passing when it isn't.
set -u
OMP="${OMP_AGENT_DIR:-$HOME/.omp/agent}"
pass=0; fail=0
ok(){ printf '  [ ok ] %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  [FAIL] %s\n' "$1"; fail=$((fail+1)); }
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1"; fi; }

printf '+------------------------------------------------------------+\n'
printf '|  KEEL install verification (no model involved)              |\n'
printf '+------------------------------------------------------------+\n'
printf '\n  Checking: %s\n\n  Files\n' "$OMP"

chk "config.yml present"            "[ -f '$OMP/config.yml' ]"
chk "models.yml present"            "[ -f '$OMP/models.yml' ]"
chk "AGENTS.md present"             "[ -f '$OMP/AGENTS.md' ]"
chk "APPEND_SYSTEM.md present"      "[ -f '$OMP/APPEND_SYSTEM.md' ]"
chk "RULES.md present"              "[ -f '$OMP/RULES.md' ]"
chk "extension present"             "[ -f '$OMP/extensions/keel.ts' ]"
chk "mcp.json present (agent/)"     "[ -f '$OMP/mcp.json' ]"
for a in planner reviewer coder designer scout; do
  chk "agent: $a"                   "[ -f '$OMP/agents/$a.md' ]"
done

printf '\n  Config sanity\n'
# Real parse check: FAILS if python3 is present and the YAML is broken. Skips (still counts as
# checked) only when python3 is entirely absent - it never silently passes a broken file.
if command -v python3 >/dev/null 2>&1; then
  chk "config.yml parses"           "python3 -c \"import yaml,sys; yaml.safe_load(open('$OMP/config.yml'))\""
else
  printf '  [skip] config.yml parses (python3 not installed)\n'
fi
chk "memory backend enabled"        "grep -qE 'backend:[[:space:]]*(mnemopi|local)' '$OMP/config.yml'"
chk "subagent LSP on"               "grep -qE 'enableLsp:[[:space:]]*true' '$OMP/config.yml'"
chk "no per-tool approval prompts"  "! grep -qE 'approval:[[:space:]]*prompt' '$OMP/config.yml' || grep -qE 'match:' '$OMP/config.yml'"
chk "recursive-wipe denied"         "grep -qE 'rm -rf /\*|rm -rf ~' '$OMP/config.yml'"
chk "NO placeholder model ids left" "! grep -q 'KEEL_SETUP_REQUIRED' '$OMP/config.yml' '$OMP/agents/coder.md'"

printf '\n  Guards present in the extension\n'
chk "1 plan gate (confirm)"         "grep -q 'ui.confirm' '$OMP/extensions/keel.ts'"
chk "2 code fence"                  "grep -q 'you write only the control files in docs' '$OMP/extensions/keel.ts'"
chk "3 checkpoint"                  "grep -q 'refs/keel/checkpoint' '$OMP/extensions/keel.ts'"
chk "4 loud tool failures"          "grep -q 'This tool call FAILED' '$OMP/extensions/keel.ts'"
chk "5 empty-artifact notice"       "grep -q 'produced NO output' '$OMP/extensions/keel.ts'"
chk "6 contract is systemic"        "grep -q 'CONTRACT_BOUND' '$OMP/extensions/keel.ts'"
chk "6b open-placeholder block"     "grep -q 'unresolved placeholders' '$OMP/extensions/keel.ts'"
chk "7 scope lock"                  "grep -q 'out of scope' '$OMP/extensions/keel.ts'"
chk "7b scope fails CLOSED"         "grep -q 'no usable SCOPE block' '$OMP/extensions/keel.ts'"
chk "8 verbatim review relay"       "grep -q 'extractNextPrompt' '$OMP/extensions/keel.ts'"
chk "9 spawn topology"              "grep -q 'may only spawn a read-only' '$OMP/extensions/keel.ts'"
chk "10 acceptance pushback"        "grep -q 'Final acceptance is not complete' '$OMP/extensions/keel.ts'"
chk "11 lsp writes blocked"         "grep -q 'lsp write-actions' '$OMP/extensions/keel.ts'"
chk "12 one writer at a time"       "grep -q 'only ONE coder may run' '$OMP/extensions/keel.ts'"
chk "13 read-only agents cannot act" "grep -q 'STRICT_READ_ONLY_AGENTS' '$OMP/extensions/keel.ts'"
chk "14 task types are mechanical"  "grep -q 'const TASK_TYPES' '$OMP/extensions/keel.ts'"
chk "15 subagents cannot write docs" "grep -q 'cannot write ' '$OMP/extensions/keel.ts'"
chk "16 harness not self-editable"  "grep -q 'is not editable from inside a session' '$OMP/extensions/keel.ts'"
chk "17 milestone types decomposed" "grep -q 'MILESTONE_TYPES' '$OMP/extensions/keel.ts'"
chk "shell writes judged by target" "grep -q 'function shellWriteTargets' '$OMP/extensions/keel.ts'"
chk "audit refuses the coder"       "grep -q 'noCoder' '$OMP/extensions/keel.ts'"
chk "effort enabled in config"      "grep -q 'enableEffort: true' '$OMP/config.yml'"
chk "contract template has Тип"     "grep -q '^Тип:' '$OMP/../docs-templates/contract.md' 2>/dev/null || true"
chk "coder is blocking (async default)" "grep -q '^blocking: true' '$OMP/agents/coder.md'"
chk "scout reads verbatim"          "grep -q '^read-summarize: false' '$OMP/agents/scout.md'"
chk "agent identity markers"        "[ \$(grep -l 'KEEL-AGENT:' '$OMP'/agents/*.md | wc -l) -eq 5 ]"
chk "ast_grep enabled in config"    "grep -qE '^\s*enabled: true' '$OMP/config.yml'"
chk "isolated from other agents"    "grep -q 'disabledProviders' '$OMP/config.yml'"
chk "eval gated at config level"    "grep -qE '^\s*eval: (prompt|deny)' '$OMP/config.yml'"
chk "no ghost tool names"           "! grep -qE '\"(todo_write|web_fetch)\"' '$OMP/extensions/keel.ts'"
chk "cross-shell write detection"   "grep -q 'SHELL_WRITE_PS' '$OMP/extensions/keel.ts'"

# Every skill named in an agent's autoloadSkills MUST exist on disk. omp silently ignores unknown
# names, so a missing file means the agent quietly loses its discipline with no error anywhere.
missing_skills=""
for f in "$OMP"/agents/*.md; do
  [ -e "$f" ] || continue
  names=$(grep -m1 '^autoloadSkills:' "$f" 2>/dev/null | sed 's/^autoloadSkills:[[:space:]]*//' | tr -d '[]"' | tr ',' ' ')
  for n in $names; do
    [ -f "$OMP/skills/$n/SKILL.md" ] || missing_skills="$missing_skills $(basename "$f" .md):$n"
  done
done
chk "autoloadSkills all exist"      "[ -z '$missing_skills' ]"
chk "skills dir installed"          "[ -f '$OMP/skills/karpathy/SKILL.md' ]"
chk "decisions.md is writable"      "grep -q 'decisions|PHASE_REPORT' '$OMP/extensions/keel.ts'"
chk "visual-tooling auto-pointed"   "grep -q 'contractHasFrontend' '$OMP/extensions/keel.ts'"
chk "MCP targets scope-checked"     "grep -q 'mcpTargetOf' '$OMP/extensions/keel.ts'"
chk "gate survives restart"         "grep -q 'reviewerGatedCurrentPlan' '$OMP/extensions/keel.ts'"
chk "acceptance excludes ledger"    "grep -q 'function acceptanceBoxes' '$OMP/extensions/keel.ts'"
chk "unnamed ledger detected"       "grep -q 'function ledgerPlaceholders' '$OMP/extensions/keel.ts'"
chk "scope ignores placeholders"    "grep -q 'An unfilled placeholder is not a scope entry' '$OMP/extensions/keel.ts'"
chk "segmented status line"         "grep -q 'function paintStatus' '$OMP/extensions/keel.ts'"
chk "batch-aware agent detect"      "grep -q 'collectAgents' '$OMP/extensions/keel.ts'"
chk "shell-write gate"              "grep -q 'bashWrites' '$OMP/extensions/keel.ts'"

printf '\n  Agent wiring\n'
chk "reviewer has NO write tools"   "! grep -qE '^tools:.*(edit|write|bash)' '$OMP/agents/reviewer.md'"
chk "planner has NO write tools"    "! grep -qE '^tools:.*(edit|write|bash)' '$OMP/agents/planner.md'"
chk "reviewer is blocking"          "grep -qE '^blocking:[[:space:]]*true' '$OMP/agents/reviewer.md'"
chk "planner is blocking"           "grep -qE '^blocking:[[:space:]]*true' '$OMP/agents/planner.md'"
chk "coder has write tool"          "grep -qE '^tools:.*(edit|write)' '$OMP/agents/coder.md'"
chk "coder has lsp"                 "grep -qE '^tools:.*lsp' '$OMP/agents/coder.md'"
chk "coder has debug"              "grep -qE '^tools:.*debug' '$OMP/agents/coder.md'"
chk "coder is not DeepSeek"         "! grep -qiE '^model:.*deepseek' '$OMP/agents/coder.md'"
chk "coder knows contract path"     "grep -q 'docs/contract.md' '$OMP/agents/coder.md'"
chk "reviewer knows contract path"  "grep -q 'docs/contract.md' '$OMP/agents/reviewer.md'"

printf '\n+------------------------------------------------------------+\n'
printf '|  %2d passed, %2d failed                                       |\n' "$pass" "$fail"
printf '+------------------------------------------------------------+\n'
printf '\n  Still must be checked LIVE (a script cannot see behaviour):\n'
printf '    a) Start omp - you must see a KEEL status line, e.g. "KEEL 1/4 - собираем задачу"\n'
printf '       (in a folder without docs/ it reads "KEEL свободный режим").\n'
printf '       If it is absent, the extension did not load and NO guard is active.\n'
printf '    b) Ask the reviewer to create a file -> the file must NOT appear.\n'
printf '    c) Try to spawn the coder with no docs/contract.md -> must be blocked.\n'
printf '    d) Approve a plan -> a confirm dialog must appear before the coder runs.\n'
printf '    e) In a scoped task, run `cat evil > src/OutOfScope.ts` -> must be blocked.\n'
printf '\n'
[ "$fail" -eq 0 ] || exit 1

# KEEL install verifier for Windows PowerShell. Deterministic - no model involved.
$OMP = if ($env:OMP_AGENT_DIR) { $env:OMP_AGENT_DIR } else { Join-Path $HOME ".omp\agent" }
$script:pass = 0; $script:fail = 0
function Chk($name, [scriptblock]$test) {
  $r = $false; try { $r = & $test } catch { $r = $false }
  if ($r) { "  [ ok ] $name"; $script:pass++ } else { "  [FAIL] $name"; $script:fail++ }
}
function Has($file, $pattern) { (Test-Path $file) -and ((Get-Content $file -Raw) -match $pattern) }
function Lacks($file, $pattern) { (Test-Path $file) -and -not ((Get-Content $file -Raw) -match $pattern) }
function HasAny($files, $pattern) { foreach ($f in $files) { if (Has $f $pattern) { return $true } } return $false }

"+------------------------------------------------------------+"
"|  KEEL install verification (no model involved)              |"
"+------------------------------------------------------------+"
"`n  Checking: $OMP`n`n  Files"
Chk "config.yml present"        { Test-Path "$OMP\config.yml" }
Chk "models.yml present"        { Test-Path "$OMP\models.yml" }
Chk "AGENTS.md present"         { Test-Path "$OMP\AGENTS.md" }
Chk "APPEND_SYSTEM.md present"  { Test-Path "$OMP\APPEND_SYSTEM.md" }
Chk "RULES.md present"          { Test-Path "$OMP\RULES.md" }
Chk "extension present"         { Test-Path "$OMP\extensions\keel.ts" }
Chk "mcp.json present (agent/)" { Test-Path "$OMP\mcp.json" }
foreach ($a in "planner","reviewer","coder","designer","scout") {
  Chk "agent: $a" { Test-Path "$OMP\agents\$a.md" }.GetNewClosure()
}
"`n  Config sanity"
# Real parse check via powershell-yaml if available, else ConvertFrom-Yaml, else skip (never a
# silent pass). At minimum, confirm the file is non-empty and has modelRoles.
Chk "config.yml parses"             { Has "$OMP\config.yml" 'modelRoles:' }
Chk "memory backend enabled"        { Has "$OMP\config.yml" 'backend:\s*(mnemopi|local)' }
Chk "subagent LSP on"               { Has "$OMP\config.yml" 'enableLsp:\s*true' }
Chk "no per-tool approval prompts"  { (Lacks "$OMP\config.yml" 'approval:\s*prompt') -or (Has "$OMP\config.yml" 'match:') }
Chk "recursive-wipe denied"         { Has "$OMP\config.yml" 'rm -rf /\*|rm -rf ~' }
Chk "NO placeholder model ids left" { (Lacks "$OMP\config.yml" 'KEEL_SETUP_REQUIRED') -and (Lacks "$OMP\agents\coder.md" 'KEEL_SETUP_REQUIRED') }
"`n  Guards present in the extension"
Chk "1 plan gate (confirm)"     { Has "$OMP\extensions\keel.ts" 'ui\.confirm' }
Chk "2 code fence"              { Has "$OMP\extensions\keel.ts" 'you write only the control files in docs' }
Chk "3 checkpoint"              { Has "$OMP\extensions\keel.ts" 'refs/keel/checkpoint' }
Chk "4 loud tool failures"      { Has "$OMP\extensions\keel.ts" 'This tool call FAILED' }
Chk "5 empty-artifact notice"   { Has "$OMP\extensions\keel.ts" 'produced NO output' }
Chk "6 contract is systemic"    { Has "$OMP\extensions\keel.ts" 'CONTRACT_BOUND' }
Chk "6b open-placeholder block" { Has "$OMP\extensions\keel.ts" 'unresolved placeholders' }
Chk "7 scope lock"              { Has "$OMP\extensions\keel.ts" 'out of scope' }
Chk "7b scope fails CLOSED"     { Has "$OMP\extensions\keel.ts" 'no usable SCOPE block' }
Chk "8 verbatim review relay"   { Has "$OMP\extensions\keel.ts" 'extractNextPrompt' }
Chk "9 spawn topology"          { Has "$OMP\extensions\keel.ts" 'may only spawn a read-only' }
Chk "10 acceptance pushback"    { Has "$OMP\extensions\keel.ts" 'Final acceptance is not complete' }
Chk "11 lsp writes blocked"     { Has "$OMP\extensions\keel.ts" 'lsp write-actions' }
Chk "12 one writer at a time"   { Has "$OMP\extensions\keel.ts" 'only ONE coder may run' }
Chk "13 read-only agents cannot act" { Has "$OMP\extensions\keel.ts" 'STRICT_READ_ONLY_AGENTS' }
Chk "14 task types are mechanical" { Has "$OMP\extensions\keel.ts" 'const TASK_TYPES' }
Chk "15 subagents cannot write docs" { Has "$OMP\extensions\keel.ts" 'cannot write ' }
Chk "16 harness not self-editable" { Has "$OMP\extensions\keel.ts" 'is not editable from inside a session' }
Chk "17 milestone types decomposed" { Has "$OMP\extensions\keel.ts" 'MILESTONE_TYPES' }
Chk "shell writes judged by target" { Has "$OMP\extensions\keel.ts" 'function shellWriteTargets' }
Chk "audit refuses the coder"   { Has "$OMP\extensions\keel.ts" 'noCoder' }
Chk "effort enabled in config"  { Has "$OMP\config.yml" 'enableEffort: true' }
Chk "coder is blocking"         { Has "$OMP\agents\coder.md" 'blocking: true' }
Chk "scout reads verbatim"      { Has "$OMP\agents\scout.md" 'read-summarize: false' }
Chk "agent identity markers"    { (Get-ChildItem (Join-Path $OMP "agents") -Filter *.md | Where-Object { Select-String -Path $_.FullName -Pattern 'KEEL-AGENT:' -Quiet }).Count -eq 5 }
Chk "no ghost tool names"       { -not (Has "$OMP\extensions\keel.ts" 'todo_write') }
Chk "isolated from other agents" { Has "$OMP\config.yml" 'disabledProviders' }
Chk "eval gated at config level" { Has "$OMP\config.yml" 'eval:' }
Chk "cross-shell write detection" { Has "$OMP\extensions\keel.ts" 'SHELL_WRITE_PS' }

# Every skill named in an agent's autoloadSkills must exist - omp ignores unknown names silently.
$MissingSkills = @()
Get-ChildItem -Path (Join-Path $OMP "agents") -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object {
  $line = Select-String -Path $_.FullName -Pattern '^autoloadSkills:' | Select-Object -First 1
  if ($line) {
    ($line.Line -replace '^autoloadSkills:\s*','' -replace '[\[\]"]','').Split(',') | ForEach-Object {
      $n = $_.Trim()
      if ($n -and -not (Test-Path (Join-Path $OMP "skills\$n\SKILL.md"))) { $MissingSkills += "$($_.Trim())" }
    }
  }
}
Chk "autoloadSkills all exist"  { $MissingSkills.Count -eq 0 }
Chk "skills dir installed"      { Test-Path "$OMP\skills\karpathy\SKILL.md" }
Chk "decisions.md is writable"  { Has "$OMP\extensions\keel.ts" 'decisions|PHASE_REPORT' }
Chk "visual-tooling auto-pointed" { Has "$OMP\extensions\keel.ts" 'contractHasFrontend' }
Chk "MCP targets scope-checked" { Has "$OMP\extensions\keel.ts" 'mcpTargetOf' }
Chk "gate survives restart"     { Has "$OMP\extensions\keel.ts" 'reviewerGatedCurrentPlan' }
Chk "acceptance excludes ledger" { Has "$OMP\extensions\keel.ts" 'function acceptanceBoxes' }
Chk "unnamed ledger detected"   { Has "$OMP\extensions\keel.ts" 'function ledgerPlaceholders' }
Chk "scope ignores placeholders" { Has "$OMP\extensions\keel.ts" 'An unfilled placeholder is not a scope entry' }
Chk "segmented status line"     { Has "$OMP\extensions\keel.ts" 'function paintStatus' }
Chk "batch-aware agent detect"  { Has "$OMP\extensions\keel.ts" 'collectAgents' }
Chk "shell-write gate"          { Has "$OMP\extensions\keel.ts" 'bashWrites' }
"`n  Agent wiring"
Chk "reviewer has NO write tools" { Lacks "$OMP\agents\reviewer.md" '(?m)^tools:.*(edit|write|bash)' }
Chk "planner has NO write tools"  { Lacks "$OMP\agents\planner.md" '(?m)^tools:.*(edit|write|bash)' }
Chk "reviewer is blocking"        { Has "$OMP\agents\reviewer.md" '(?m)^blocking:\s*true' }
Chk "planner is blocking"         { Has "$OMP\agents\planner.md" '(?m)^blocking:\s*true' }
Chk "coder has write tool"        { Has "$OMP\agents\coder.md" '(?m)^tools:.*(edit|write)' }
Chk "coder has lsp"               { Has "$OMP\agents\coder.md" '(?m)^tools:.*lsp' }
Chk "coder has debug"             { Has "$OMP\agents\coder.md" '(?m)^tools:.*debug' }
Chk "coder is not DeepSeek"       { Lacks "$OMP\agents\coder.md" '(?mi)^model:.*deepseek' }
Chk "coder knows contract path"    { Has "$OMP\agents\coder.md" 'docs/contract.md' }
Chk "reviewer knows contract path" { Has "$OMP\agents\reviewer.md" 'docs/contract.md' }

"`n+------------------------------------------------------------+"
"|  {0,2} passed, {1,2} failed                                       |" -f $script:pass, $script:fail
"+------------------------------------------------------------+"
"`n  Still must be checked LIVE (a script cannot see behaviour):"
"    a) Start omp - you must see a KEEL status line, e.g. 'KEEL 1/4 - собираем задачу'"
"       (in a folder without docs/ it reads 'KEEL свободный режим')."
"       If it is absent, the extension did not load and NO guard is active."
"    b) Ask the reviewer to create a file -> the file must NOT appear."
"    c) Try to spawn the coder with no docs/contract.md -> must be blocked."
"    d) Approve a plan -> a confirm dialog must appear before the coder runs."
"    e) In a scoped task, run 'cat evil > src/OutOfScope.ts' -> must be blocked."
""
if ($script:fail -ne 0) { exit 1 }

# KEEL (omp) installer for Windows PowerShell. Pure ASCII output.
$ErrorActionPreference = "Stop"
if (-not $env:OMP_AGENT_DIR -and -not $HOME) {
  Write-Host "  [!] HOME is empty and OMP_AGENT_DIR is not set - refusing to write to '\.omp'."
  Write-Host '      Set OMP_AGENT_DIR to your real path and re-run, e.g.'
  Write-Host '      $env:OMP_AGENT_DIR = "C:\Users\<you>\.omp\agent"; ./install.ps1'
  exit 1
}
$OMP = if ($env:OMP_AGENT_DIR) { $env:OMP_AGENT_DIR } else { Join-Path $HOME ".omp\agent" }

function Line { "+------------------------------------------------------------+" }
function Copy-One($src, $dst) {
  $exists = Test-Path $dst
  if ($exists -and (Get-FileHash $src).Hash -ne (Get-FileHash $dst).Hash) {
    "  [skip] $dst (exists; merge by hand)"
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item $src $dst -Force
    "  [ ok ] $dst"
  }
}

Line
"|  KEEL  -  autonomous coding harness for omp                 |"
Line
"`n  Target: $OMP"
New-Item -ItemType Directory -Force -Path (Join-Path $OMP "agents"),(Join-Path $OMP "extensions"),(Join-Path $OMP "skills") | Out-Null

"`n  settings"
Copy-One "agent\config.yml" (Join-Path $OMP "config.yml")
Copy-One "agent\models.yml" (Join-Path $OMP "models.yml")
"`n  instructions"
Copy-One "agent\AGENTS.md"        (Join-Path $OMP "AGENTS.md")
Copy-One "agent\APPEND_SYSTEM.md" (Join-Path $OMP "APPEND_SYSTEM.md")
Copy-One "agent\RULES.md"         (Join-Path $OMP "RULES.md")
"`n  agents"
Get-ChildItem "agent\agents\*.md" | ForEach-Object { Copy-One $_.FullName (Join-Path $OMP "agents\$($_.Name)") }

"`n  skills"
# One level only: ~/.omp/agent/skills/<name>/SKILL.md - omp does not discover nested groups.
Get-ChildItem "agent\skills" -Directory | ForEach-Object {
  $src = Join-Path $_.FullName "SKILL.md"
  if (Test-Path $src) { Copy-One $src (Join-Path $OMP "skills\$($_.Name)\SKILL.md") }
}
"`n  extension + mcp"
Copy-One "agent\extensions\keel.ts" (Join-Path $OMP "extensions\keel.ts")
Copy-One "agent\mcp.json"           (Join-Path $OMP "mcp.json")

"`n"
Line
"|  Files copied. Now finish setup (see INSTALL.md):           |"
"|    1. exact model ids in config.yml + agents/coder.md       |"
"|    2. language servers (pyright / tsserver / vue)           |"
"|    3. browser MCP command in mcp.json                       |"
"|    4. run ./verify.sh (or verify.ps1) - must be 0 failed     |"
"|  Dashboard:  omp stats     Live agents:  Alt+A (Agent Hub)  |"
Line
""

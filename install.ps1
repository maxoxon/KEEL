# KEEL installer for Windows PowerShell.
# Installs the official omp runtime when it is missing, then installs KEEL.
$ErrorActionPreference = "Stop"
if (-not $env:OMP_AGENT_DIR -and -not $HOME) {
  Write-Host "  [!] HOME is empty and OMP_AGENT_DIR is not set - refusing to write to '\.omp'."
  Write-Host '      Set OMP_AGENT_DIR and re-run, e.g.'
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
"|  KEEL  -  engineering harness for omp                     |"
Line

Write-Host "`n  checking omp"
if (Get-Command omp -ErrorAction SilentlyContinue) {
  Write-Host "  [ ok ] omp found: $((Get-Command omp).Source)"
} else {
  Write-Host "  omp was not found. Installing the official omp distribution..."
  try {
    irm https://omp.sh/install.ps1 | iex
  } catch {
    Write-Host "  [FAIL] official omp installer failed. KEEL was not installed."
    throw
  }
  $candidates = @((Join-Path $HOME ".bun\bin"),(Join-Path $HOME ".local\bin"))
  foreach ($dir in $candidates) {
    if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) { $env:Path = "$dir;$env:Path" }
  }
  if (-not (Get-Command omp -ErrorAction SilentlyContinue)) {
    Write-Host "  [FAIL] omp installation completed but 'omp' is not on PATH."
    Write-Host "         Open a new PowerShell window (or add the omp install directory to PATH), then re-run."
    exit 1
  }
  Write-Host "  [ ok ] omp installed: $((Get-Command omp).Source)"
}
try { Write-Host "  Version: $(& omp --version 2>$null)" } catch { Write-Host "  Version: unknown" }

Write-Host "`n  Target: $OMP"
New-Item -ItemType Directory -Force -Path (Join-Path $OMP "agents"),(Join-Path $OMP "extensions"),(Join-Path $OMP "skills") | Out-Null

Write-Host "`n  settings"
Copy-One "agent\config.yml" (Join-Path $OMP "config.yml")
Copy-One "agent\models.yml" (Join-Path $OMP "models.yml")
Write-Host "`n  instructions"
Copy-One "agent\AGENTS.md"        (Join-Path $OMP "AGENTS.md")
Copy-One "agent\APPEND_SYSTEM.md" (Join-Path $OMP "APPEND_SYSTEM.md")
Copy-One "agent\RULES.md"         (Join-Path $OMP "RULES.md")
Write-Host "`n  agents"
Get-ChildItem "agent\agents\*.md" | ForEach-Object { Copy-One $_.FullName (Join-Path $OMP "agents\$($_.Name)") }
Write-Host "`n  skills"
Get-ChildItem "agent\skills" -Directory | ForEach-Object {
  $src = Join-Path $_.FullName "SKILL.md"
  if (Test-Path $src) { Copy-One $src (Join-Path $OMP "skills\$($_.Name)\SKILL.md") }
}
Write-Host "`n  extension + mcp"
Copy-One "agent\extensions\keel.ts" (Join-Path $OMP "extensions\keel.ts")
Copy-One "agent\mcp.json"           (Join-Path $OMP "mcp.json")

Write-Host "`n"
Line
"|  KEEL installed on top of omp.                              |"
"|  Finish setup (see INSTALL.md):                             |"
"|    1. exact model ids in config.yml + agents/coder.md       |"
"|    2. language servers (pyright / tsserver / vue)           |"
"|    3. browser MCP command in mcp.json                       |"
"|    4. run ./verify.sh (or verify.ps1) - must be 0 failed     |"
Line
Write-Host ""

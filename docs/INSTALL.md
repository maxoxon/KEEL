# Installing KEEL

> Installation and configuration guide for KEEL on top of [omp](https://omp.sh/).

KEEL is not a standalone coding-agent runtime. It installs as an engineering layer into an existing `omp` installation.

The repository installers can bootstrap the official `omp` distribution when `omp` is missing. They do not replace an existing `omp` installation.

For daily usage, see [USAGE.md](USAGE.md). For internals, see [ARCHITECTURE.md](ARCHITECTURE.md). For the exact installed file inventory, see [MANIFEST.md](MANIFEST.md).

---

## 1. Requirements

You need:

- macOS, Linux, Git Bash, or Windows PowerShell;
- network access during installation if `omp` is not already installed;
- at least one model provider available to `omp`;
- a project where you want to use the harness.

A Git repository is strongly recommended. KEEL can create a pre-change checkpoint only when the project is a Git worktree.

KEEL does **not** require you to put provider credentials into KEEL's `config.yml`. Authentication is handled by `omp`.

---

## 2. Clone KEEL

```bash
git clone https://github.com/maxoxon/KEEL.git
cd KEEL
```

On Windows PowerShell:

```powershell
git clone https://github.com/maxoxon/KEEL.git
Set-Location KEEL
```

---

## 3. Run the installer

### macOS / Linux / Git Bash

```bash
./install.sh
```

### Windows PowerShell

```powershell
./install.ps1
```

The installer follows this order:

```text
check omp
   │
   ├── installed → keep it
   │
   └── missing → run the official omp installer
                    │
                    └── verify omp is now available
                              │
                              ▼
                       install KEEL files
```

The Unix installer uses:

```text
https://omp.sh/install
```

The PowerShell installer uses:

```text
https://omp.sh/install.ps1
```

These are the official upstream installation endpoints used by omp.

If the omp bootstrap fails or `omp` is still unavailable afterwards, the KEEL installer stops before copying the harness files.

If `omp` is already installed, the bootstrap step is skipped.

---

## 4. Installation target

By default KEEL installs into:

```text
~/.omp/agent/
```

The installer respects `OMP_AGENT_DIR` when it is set.

The resulting structure is approximately:

```text
~/.omp/agent/
├── AGENTS.md
├── APPEND_SYSTEM.md
├── RULES.md
├── config.yml
├── models.yml
├── mcp.json
├── agents/
│   ├── planner.md
│   ├── reviewer.md
│   ├── coder.md
│   ├── designer.md
│   └── scout.md
├── extensions/
│   └── keel.ts
└── skills/
    └── <skill>/SKILL.md
```

KEEL is therefore a configuration/extension layer on top of the omp runtime, not a second executable runtime.

---

## 5. Existing files are not silently overwritten

The installers preserve the existing conflict behavior:

- if a destination file does not exist, it is copied;
- if it exists and is identical, it is accepted;
- if it exists and differs, the installer reports `skip` and tells you to merge manually.

This is deliberate. KEEL must not silently destroy an existing user's omp configuration.

In particular, do not assume that `config.yml` can safely be replaced wholesale on a machine that already uses omp.

The installer does not manage provider credentials stored by omp.

---

## 6. Configure models

After installation, inspect:

```text
~/.omp/agent/config.yml
```

or the corresponding `OMP_AGENT_DIR` path.

Replace the `KEEL_SETUP_REQUIRED` placeholders with real model IDs appropriate for your provider setup.

The role mapping is conceptually:

| Role | Purpose | Important requirement |
|---|---|---|
| `default` | Primary/orchestrator | responsive enough for coordination |
| `plan` | Planner | reliable structured output |
| `slow` | Reviewer | reliable structured output |
| `vision` | Image/screenshot analysis | vision-capable model |
| `designer` | UI/UX concepts | depends on your workflow |
| `smol` | Scout/read-only reconnaissance | cheap and fast is usually sufficient |
| `tiny` | lightweight background tasks | cheapest suitable model |

The coder model is configured in:

```text
~/.omp/agent/agents/coder.md
```

The planner, reviewer, and coder participate in structured-output protocols. Choose models that reliably produce the schemas required by the installed harness.

Do not remove the role definitions simply because a role is not used on every task; the workflow depends on the installed agent topology.

---

## 7. Authentication

KEEL does not own provider authentication.

Use the authentication mechanism provided by `omp`. For example, the upstream workflow can authenticate interactively from an omp session or use the provider environment variables supported by your setup.

Do not place secrets into:

```text
config.yml
agent/*.md
README.md
```

Treat the upstream omp authentication mechanism as the source of truth for credentials.

See the official [omp documentation](https://omp.sh/) for provider-specific authentication details.

---

## 8. Verify the installation

Run the deterministic verifier from the KEEL repository:

### macOS / Linux / Git Bash

```bash
./verify.sh
```

### Windows PowerShell

```powershell
./verify.ps1
```

The verifier does not use an LLM. It reads the installed files and checks that required artifacts, configuration properties, guards, agents, and skills are present.

A successful installation should finish with zero failed checks.

The verifier also checks for unresolved `KEEL_SETUP_REQUIRED` model placeholders. Those placeholders must be replaced before the harness is considered configured.

---

## 9. Language servers and browser verification

Some KEEL workflows use omp's LSP integration for repository navigation and diagnostics. The exact language server depends on the project and is not installed by KEEL itself.

Install the language servers appropriate for your project and ensure omp can access them.

For UI work, the contract-bound implementation path can use browser/MCP tooling for live verification. KEEL ships the browser MCP configuration in `mcp.json`; the shipped configuration uses `patchright-mcp`, but the command still depends on the local Node/npm environment and must be available where you run omp. The `visual-tooling` skill defines the browser verification procedure.

The reviewer is **not** the browser driver: its declared tools are read-only code/analysis tools and do not include browser/MCP interaction. It can request a browser run through its structured `needs` output when the caller must perform an external check.

Do not treat the presence of `mcp.json` as proof that the browser server is installed and working. Verify the external dependency in the environment where you intend to use it.

---

## 10. Configuration layering

omp applies configuration in layers. Conceptually:

```text
built-in defaults
      ↓
user configuration (~/.omp/agent)
      ↓
project configuration (.omp)
      ↓
overlay
```

Project configuration can override user configuration.

This means KEEL can be installed globally while a particular project supplies a more specific omp configuration.

The KEEL installer targets the user agent directory by default. If you deliberately use a project-scoped omp configuration, place the corresponding harness files in the project scope using omp's configuration rules rather than copying them blindly into both scopes.

---

## 11. What KEEL installs

The harness consists of several cooperating layers:

### Instructions

```text
AGENTS.md
APPEND_SYSTEM.md
RULES.md
```

They have different reach inside omp. `AGENTS.md` and `APPEND_SYSTEM.md` are primary-session material; `RULES.md` is the shared invariant layer. See [ARCHITECTURE.md](ARCHITECTURE.md) for the exact model.

### Agent definitions

```text
agents/planner.md
agents/reviewer.md
agents/coder.md
agents/designer.md
agents/scout.md
```

These define the specialised roles used by the workflow.

### Runtime extension

```text
extensions/keel.ts
```

This is the mechanical enforcement layer. It implements plan gates, scope locking, ownership rules, topology restrictions, acceptance checks, and other runtime guards.

### Skills

```text
skills/<name>/SKILL.md
```

Skills package reusable role-specific procedures.

### Configuration

```text
config.yml
models.yml
mcp.json
```

These connect the harness to omp's runtime capabilities.

See [MANIFEST.md](MANIFEST.md) for the current repository inventory.

---

## 12. First run

Once configuration and verification are complete:

```bash
cd /path/to/your/project
omp
```

Then describe the task normally. Do not start by manually creating `contract.md` or `plan.md` unless you are intentionally recovering or debugging a task state.

The normal workflow creates and maintains those project-state documents as the task progresses.

See [USAGE.md](USAGE.md) for the user workflow.

---

## 13. Troubleshooting

### `omp` is not found after installation

Open a new terminal so the installation directory is on your normal `PATH`, or add the directory reported by the official omp installer to `PATH`.

Then verify:

```bash
omp
```

If the installer still cannot find it, re-run the KEEL installer after fixing `PATH`.

### The installer says `skip`

That means a destination file already exists and differs from the KEEL copy. This is intentional protection against overwriting your existing configuration.

Compare the two files and merge the required KEEL changes manually.

### Verification reports a missing agent or skill

Confirm that the KEEL files were installed into the same directory used by `OMP_AGENT_DIR`/omp.

Then re-run the verifier.

### Verification reports a model placeholder

Replace every `KEEL_SETUP_REQUIRED` value in the installed role configuration and coder agent definition with a real model ID.

### KEEL appears installed but is inactive

Check:

```text
<OMP_AGENT_DIR>/extensions/keel.ts
```

and run the verifier. If the file is present but hooks are not active, inspect the omp runtime/version and logs before modifying KEEL prompts.

### An existing omp setup is important

Do not delete your existing configuration to make the installer pass. KEEL is designed to preserve conflicting files and make the merge explicit.

---

## 14. Updating KEEL

Re-run the installer from the newer KEEL checkout.

The same conflict behavior applies: unchanged files can be refreshed, while differing existing files are reported rather than silently overwritten.

After an update:

```bash
./verify.sh
```

or on Windows:

```powershell
./verify.ps1
```

Then start `omp` and verify the harness behaves as expected before relying on it for important work.

For changes to the harness itself, read [DEVELOPMENT.md](DEVELOPMENT.md).

---

## 15. Custom installation directory

Set `OMP_AGENT_DIR` before running the installer.

Unix:

```bash
export OMP_AGENT_DIR="$HOME/.omp/agent"
./install.sh
```

PowerShell:

```powershell
$env:OMP_AGENT_DIR = "$HOME\.omp\agent"
./install.ps1
```

The verifier uses the same variable, so verify against the same installation target.

---

## 16. Documentation map

| Document | Purpose |
|---|---|
| [README](../README.md) | Product overview and quick start |
| [USAGE.md](USAGE.md) | Day-to-day workflow |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Internal architecture and enforcement model |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Safe changes to the harness |
| [MANIFEST.md](MANIFEST.md) | Current file/agent/skill/guard inventory |
| [omp](https://omp.sh/) | Upstream runtime and authentication documentation |

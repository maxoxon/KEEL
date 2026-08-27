# KEEL Technical Manifest

> Current inventory of the KEEL harness. This is an implementation snapshot, not a separate source of truth.

For architecture and rationale, read [ARCHITECTURE.md](ARCHITECTURE.md). For installation, read [INSTALL.md](INSTALL.md). For maintainer rules, read [DEVELOPMENT.md](DEVELOPMENT.md).

When this document disagrees with the running implementation, prefer `agent/extensions/keel.ts`, the agent definitions, the verification scripts, and the actual omp behavior. Update this manifest after implementation changes.

---

## 1. Repository layout

```text
KEEL/
├── agent/
│   ├── AGENTS.md
│   ├── APPEND_SYSTEM.md
│   ├── RULES.md
│   ├── config.yml
│   ├── models.yml
│   ├── mcp.json
│   ├── agents/
│   │   ├── planner.md
│   │   ├── reviewer.md
│   │   ├── coder.md
│   │   ├── designer.md
│   │   └── scout.md
│   ├── extensions/
│   │   └── keel.ts
│   └── skills/
│       └── <skill>/SKILL.md
├── docs/
│   ├── INSTALL.md
│   ├── USAGE.md
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT.md
│   └── MANIFEST.md
├── docs-templates/
├── tests/
├── install.sh
├── install.ps1
├── verify.sh
├── verify.ps1
└── README.md
```

`agent/` is the installable harness. Repository `docs/` contains documentation. A project's own `docs/` directory is runtime task state created/maintained by KEEL; these are different things.

---

## 2. Instruction layers

| File | Reach | Purpose |
|---|---|---|
| `AGENTS.md` | Primary/orchestrator | High-level orchestrator identity, role map, and operating posture |
| `APPEND_SYSTEM.md` | Primary/orchestrator | Harness workflow, phases, state handling, parallelism, memory/compaction guidance |
| `RULES.md` | Primary + subagents | Cross-agent invariants that must survive role boundaries |

Do not assume primary-session instruction text is automatically visible to subagents. Agent definitions must carry the information required by their role.

---

## 3. Agent roles

| Agent | Purpose | Intended project-code writes | Blocking |
|---|---|---:|---:|
| `planner.md` | Plan + contract | No | Yes |
| `reviewer.md` | Independent review + next action | No | Yes |
| `coder.md` | Approved implementation | **Yes** | Yes |
| `designer.md` | UI/UX exploration | No | No |
| `scout.md` | Read-only repository reconnaissance | No | No |

The primary session is the orchestrator and is not represented by a normal subagent Markdown file.

The intended topology is:

```text
primary
├── planner ──> scout
├── reviewer ─> scout
├── designer
└── coder ────> scout
```

The runtime extension and omp's native agent filtering prevent unrestricted recursive spawning and concurrent writers.

---

## 4. Agent tools and boundaries

The exact frontmatter in each agent file is authoritative. Conceptually:

- planner: repository reads, grep/glob, LSP navigation;
- reviewer: repository reads, LSP/navigation, AST inspection, image inspection where configured;
- coder: read/write/edit, shell, grep/glob, LSP, debugging and inspection tools available to the harness;
- designer: read-only repository and image inspection;
- scout: read-only repository reconnaissance.

omp can derive or add tools at runtime. Do not treat the Markdown allowlist as a complete description of every runtime tool. KEEL therefore performs additional read-only and mutation checks in the extension.

---

## 5. Skills

Skills live exactly one level below the skill directory:

```text
~/.omp/agent/skills/<name>/SKILL.md
```

The current harness includes the following skill families:

| Skill | Main roles | Purpose |
|---|---|---|
| `karpathy` | coder | deliberate, simple, verifiable coding |
| `surgical-coding` | coder | smallest correct change |
| `ponytail` | coder/planner/reviewer | avoid unnecessary construction |
| `worktree-freshness` | scout/coder/reviewer | avoid conclusions from stale worktrees |
| `decision-guard` | planner/reviewer | evidence-based decisions |
| `agent-brief` | reviewer | structured implementation briefs and completion criteria |
| `visual-tooling` | coder/reviewer | browser-based visual QA when required |
| `project-state` | orchestrator | project-state paths, compaction, and session continuity |

`autoloadSkills` is runtime metadata, not a promise that a file exists. `verify.sh` / `verify.ps1` therefore check that referenced skills actually exist.

---

## 6. Configuration

`agent/config.yml` contains both harness-critical settings and user-specific model-role settings.

Important harness areas include:

- model role routing;
- memory backend;
- compaction;
- image inspection;
- subagent LSP;
- approval behavior;
- shell safety patterns;
- effort configuration;
- AST grep configuration;
- provider isolation.

`agent/models.yml` is intentionally minimal and relies primarily on omp's model/provider facilities.

`agent/mcp.json` supplies the browser/MCP integration used for live UI verification when configured in the environment.

Credentials are not part of these files; authentication belongs to omp.

---

## 7. Runtime extension

`agent/extensions/keel.ts` is the mechanical enforcement layer.

The current implementation contains guard families for:

1. plan approval before coding;
2. primary-session code fencing;
3. pre-change checkpoints;
4. failed/empty tool-result visibility;
5. systemic contract gating;
6. unresolved-contract-placeholder blocking;
7. scope locking;
8. verbatim review relay;
9. agent-spawn topology;
10. final acceptance/session-stop enforcement;
11. LSP write-action blocking;
12. one-writer-at-a-time enforcement;
13. read-only agent enforcement;
14. mechanical task-type handling;
15. control-file ownership;
16. harness self-protection;
17. milestone decomposition for applicable task types.

The extension also contains shell-write target detection and special handling for audit tasks.

The exact predicates and hook behavior are defined in `agent/extensions/keel.ts`.

---

## 8. Task state

When an engineering task starts, KEEL uses project state under:

```text
project/docs/
├── contract.md
├── plan.md
├── report.md
├── review.md
├── decisions.md
└── PHASE_REPORT_<slug>.md
```

The canonical control documents are owned by the primary session. Subagents report implementation details through phase reports rather than rewriting the control documents that define their own scope or review state.

The `SCOPE` block in `plan.md` is the authoritative mutation boundary for the active task.

---

## 9. Structured output protocol

The workflow consumes structured output from specialised roles.

Conceptually:

```text
planner  → plan + contract
reviewer → verdict + next_prompt
coder    → contract_met + evidence + did_not_verify + remaining
```

These fields are protocol data. Changes require updating the producer, consumer, and deterministic verification coverage together.

---

## 10. Task types

Task type is persisted in the contract because it changes workflow mechanics.

| Type | Purpose |
|---|---|
| `bug-fix` | Root-cause-driven minimal fix |
| `small-feature` | Minimal extension of existing behavior |
| `large-feature` | Milestone-based implementation |
| `refactor` | Structural change while preserving behavior |
| `architecture-change` | Explicit architectural decision and staged verification |
| `new-project` | Verified project creation in increments |
| `audit` | Inspection/reporting without implementation by the coder |

The exact gate/effort rules are implemented in `keel.ts` and the instruction layer.

---

## 11. Installer behavior

`install.sh` and `install.ps1`:

1. resolve `OMP_AGENT_DIR` or the default `~/.omp/agent`;
2. check whether `omp` is already available;
3. bootstrap the official omp distribution only when it is missing;
4. stop before KEEL installation if omp bootstrap fails or remains unavailable;
5. create the required agent directories;
6. copy KEEL configuration, instructions, agents, skills, extension, and MCP configuration;
7. preserve the existing conflict behavior instead of silently overwriting differing files.

The installers do not own credentials and do not attempt to merge arbitrary user configuration.

---

## 12. Verification

`verify.sh` and `verify.ps1` are deterministic and LLM-free.

They check, among other things:

- required installed files;
- agent definitions;
- configuration sanity;
- model placeholders;
- extension guard presence;
- required skill files;
- agent identity markers;
- LSP/AST/configuration settings;
- provider isolation;
- shell-write detection;
- structured workflow-related markers.

The verification scripts are part of the repository's executable specification and should be updated when a required invariant changes.

---

## 13. Source-of-truth order

When documentation disagrees with implementation:

1. omp runtime/API behavior;
2. `agent/extensions/keel.ts` for mechanical enforcement;
3. agent frontmatter and instruction files;
4. `verify.sh` / `verify.ps1`;
5. this manifest;
6. prose documentation.

The manifest should be corrected after the implementation is verified; it should never be used as justification for undocumented behavior that the source does not implement.

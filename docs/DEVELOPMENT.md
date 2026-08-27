# KEEL Development Guide

This document is for people who want to modify KEEL itself.

If you only want to use KEEL, start with the [README](../README.md) and [USAGE.md](USAGE.md). If you want to install it, read [INSTALL.md](INSTALL.md). If you want to understand the architecture, read [ARCHITECTURE.md](ARCHITECTURE.md) first. The current implementation inventory is [MANIFEST.md](MANIFEST.md).

---

## 1. The core rule

KEEL is an engineering harness **on top of omp**. Do not turn it into a second coding-agent runtime.

The upstream runtime owns model invocation, built-in tools, subagent execution, sessions, context management, LSP, MCP, memory, configuration merging, and terminal UI.

KEEL owns the engineering protocol around those primitives: task contracts, planning and approval, mutation scope, role separation, review handoff, acceptance state, checkpoints, and workflow-specific runtime guards.

When a proposed change can be implemented with an existing omp primitive rather than a new KEEL mechanism, prefer the omp primitive.

---

## 2. Source of truth

When documentation and implementation disagree, use this order:

1. actual omp runtime/API behavior;
2. `agent/extensions/keel.ts` for mechanical enforcement;
3. agent frontmatter and instruction files under `agent/`;
4. `verify.sh` / `verify.ps1`;
5. `MANIFEST.md`;
6. prose documentation.

The manifest is an inventory, not executable policy.

---

## 3. Control documents are state

Important task state lives on disk rather than only in model context.

Typical state:

```text
project/
└── docs/
    ├── contract.md
    ├── plan.md
    ├── report.md
    ├── review.md
    ├── decisions.md
    └── PHASE_REPORT_<slug>.md
```

These files are part of the active harness state machine. The primary/orchestrator owns the canonical control files. Subagents must not rewrite the contract, plan/SCOPE, task registry, or review verdict. Implementation details belong in phase reports.

`review.md` is a stamped courtesy copy of the reviewer relay; the extension's in-memory relay is what the coder actually consumes. `decisions.md` is the durable engineering-decision log. `PHASE_REPORT_<slug>.md` is where subagent-specific implementation findings belong.

---

## 4. Workflow state machine

The conceptual flow is:

```text
request
  │
  ▼
contract discovery
  │
  ▼
contract complete
  │
  ▼
plan + SCOPE
  │
  ▼
Gate #1 — reviewer checks plan/contract
  │
  ▼
user approval
  │
  ▼
implementation
  │
  ├──────────────────────────────┐
  ▼                              │
conditional Gate #2 — review     │
  │                              │
  ├── changes required ──────────┘
  │
  ▼
independent acceptance
  │
  ▼
verified / closed
```

Gate #2 is not mandatory on every coder pass. The reviewer agent defines the triggers: repeated native-check failure, behavior that cannot be auto-checked, a larger diff, or a sensitive zone. The implementation loop remains bounded rather than becoming an autonomous infinite repair cycle.

The exact phase shown in the status UI is derived from durable project state. The UI is not itself the source of truth.

---

## 5. Contracts and plans

A contract answers:

> What must be true when this task is accepted?

A plan answers:

> What will change, where will it change, what is explicitly out of scope, and how will we verify it?

The plan contains the authoritative `SCOPE` block used by the runtime scope guard.

Never make the coder infer scope from prose when a machine-readable scope can be produced. If a requirement changes the scope, return to planning instead of silently expanding the existing plan.

---

## 6. Mechanical guards

The runtime extension is a guard layer, not a second orchestrator.

When adding a guard, answer four questions:

1. What invariant is protected?
2. Why is a prompt insufficient?
3. What exact tool/action is intercepted?
4. What is the safe behavior when the hook itself fails?

Prefer narrow predicates over broad heuristics. A guard should reject the smallest unsafe action rather than disable an entire capability.

Important guard classes include plan approval, primary-session code fencing, checkpoint creation, contract completeness, scope locking, role/spawn topology, single-writer sequencing, read-only enforcement, control-file protection, LSP mutation blocking, review handoff integrity, and acceptance/session-stop enforcement.

Do not choose fail-open or fail-closed globally. The correct behavior depends on the invariant. Missing mandatory scope, for example, should not silently become permission to mutate arbitrary files.

---

## 7. Tool classification

omp may expose more tools than are obvious from an agent's frontmatter. When changing read-only enforcement:

- inspect actual omp tool classification;
- do not assume the Markdown allowlist is the complete runtime tool list;
- remember that MCP tools form a separate boundary;
- test direct mutation, shell mutation, LSP mutation, and MCP mutation where applicable.

A read-only role is not safe merely because its Markdown says `read`.

The shipped reviewer is a special case: its declared tools are `read`, `grep`, `glob`, `lsp`, `ast_grep`, and `inspect_image`. It has no browser/MCP tool in its agent definition and is not the browser driver. UI verification through the browser MCP belongs to the contract-bound implementation path when `visual-tooling` is injected.

---

## 8. Agent boundaries

The intended topology is:

```text
primary/orchestrator
 ├── planner
 │    └── scout
 ├── reviewer
 │    └── scout
 ├── designer
 └── coder
      └── scout
```

The primary session controls role creation. A role may use the read-only scout where permitted, but the workflow must not become an unrestricted recursive tree.

The coder is the intended project-code writer. Planner, designer, and scout are strictly read-only under KEEL. Reviewer has no project write tools and is read-only for code/analysis, but it also does not have browser/MCP tools in its declared tool set. It can request externally run checks through its structured `needs` output. The extension still scope-checks identifiable MCP targets and blocks LSP write actions for roles that are not allowed to mutate.

---

## 9. Structured outputs

Planner, reviewer, and coder outputs are protocol messages, not merely prose.

If a field is consumed mechanically, treat its schema as an API.

Do not rename fields casually, parse model prose when a structured field exists, or let the orchestrator paraphrase a reviewer's required next action when verbatim relay is part of the protocol.

When a schema changes, update the producer, every consumer, and deterministic verification coverage together.

---

## 10. Verification

Acceptance is not identical to the coder saying `done`.

Prefer evidence from the system being changed:

```text
source change
   ↓
run / inspect real system
   ↓
compare with contract
   ↓
accept or return to coder
```

For UI work, browser/MCP verification is preferred where the contract requires behavior visible in the running application. The browser interaction is performed by the contract-bound implementation path; the reviewer does not drive the browser and instead judges the evidence or requests the required external check.

For backend work, use the real endpoint, command, database state, integration path, or other observable behavior when practical.

A green self-authored test is useful evidence, but should not be the only evidence when the acceptance contract describes a real-world behavior the test does not exercise.

---

## 11. Adding a task type

Task types are persisted in the contract because they affect mechanics.

When adding one:

1. define its semantics;
2. define effort and any additional gate behavior that is actually implemented;
3. define required evidence;
4. implement runtime behavior;
5. inject type-specific rules into relevant roles;
6. add deterministic verification coverage;
7. update `docs/MANIFEST.md`;
8. update `docs/USAGE.md` if user-visible behavior changes.

The current runtime uses task type for rules, per-spawn effort, audit coder exclusion, and milestone requirements. Do not document an approval count as active behavior unless the extension actually consumes it.

A task type that only changes prompt tone probably belongs in a skill instead.

---

## 12. Skills vs guards vs instructions

Use the lowest appropriate layer.

### Instruction

For behavioral guidance that a model can safely follow.

### Skill

For a reusable procedure loaded into selected roles.

### Runtime guard

For a rule that invalidates the engineering protocol if violated and therefore must not rely on model self-enforcement.

Examples include scope lock, control-file ownership, LSP mutation blocking, and single-writer enforcement.

Do not put every rule into `keel.ts`; that would turn KEEL into an unmaintainable second runtime.

---

## 13. Configuration changes

KEEL's config contains both harness-critical settings and user-specific settings.

Do not casually overwrite an existing `~/.omp/agent/config.yml`.

The installer should preserve existing files, make conflicts explicit, never touch credentials managed by omp, install KEEL's required files only when safe, and bootstrap the official omp installation only when omp is missing.

The installer is a bootstrapper, not a configuration-merger engine.

---

## 14. Testing changes

### Documentation-only change

- verify links and paths;
- compare commands and filenames with current files;
- ensure no behavior is claimed that the source does not implement;
- update architecture diagrams when role flow changes.

### Installer change

- existing omp installation remains untouched;
- missing omp is bootstrapped through the official installer;
- failed omp installation stops before KEEL files are copied;
- existing KEEL files retain their original conflict behavior;
- both Unix and PowerShell paths are considered.

### Agent/config change

- run `verify.sh` / `verify.ps1`;
- ensure required placeholders are resolved;
- verify every referenced skill exists;
- verify every agent path exists;
- inspect the resulting configuration where possible.

### Guard change

Test both sides:

```text
allowed operation → passes
forbidden operation → blocked
```

Also test the bypass path that motivated the guard. Blocking `edit` while allowing shell redirection to write the same file is not a complete guard.

---

## 15. Verification scripts

`verify.sh` and `verify.ps1` are intentionally LLM-free. They inspect installed state directly.

When adding a required artifact or invariant, add a deterministic verification check for it. A check should fail with a useful message identifying what is missing and where it is expected.

`tests/doc-conformance.sh` is a separate source-conformance check against a local omp checkout. It validates that KEEL's assumptions about hooks, task agents, skills, configuration, and context reach still match the upstream runtime/documentation.

---

## 16. Debugging

When KEEL appears inactive, debug from the outside inward:

1. Is `omp` running the expected installation?
2. Is the KEEL extension present in the configured agent directory?
3. Are the instruction layers installed in the expected scope?
4. Are the agent files visible to omp?
5. Are model roles configured?
6. Does task state exist under the project's `docs/`?
7. Did the relevant tool call reach the guard?
8. Did the guard classify the operation correctly?
9. Did structured output validate?
10. Is the problem only the status presentation?

Do not start by changing prompts. Establish whether the failure is runtime loading, state, classification, enforcement, or presentation.

Useful artifacts include:

```text
omp stats
~/.omp/logs/
~/.omp/agent/sessions/*.jsonl
docs/contract.md
docs/plan.md
docs/report.md
docs/review.md
docs/decisions.md
```

---

## 17. Safe evolution

Prefer small, reversible changes.

Before changing a guard or instruction:

1. identify the invariant;
2. locate the current enforcement point;
3. identify every consumer of the state/field/tool classification;
4. make the smallest change;
5. run deterministic verification;
6. test intended blocked and allowed paths;
7. update technical documentation;
8. update the manifest last.

Do not rewrite the whole harness to solve a local problem. Do not silently weaken a safety boundary because a model finds it inconvenient.

---

## 18. Documentation map

| Audience | Start here |
|---|---|
| New user | `../README.md` |
| Daily user | `USAGE.md` |
| Installation/troubleshooting | `INSTALL.md` |
| Architecture reader | `ARCHITECTURE.md` |
| Maintainer / contributor | `DEVELOPMENT.md` |
| Exact current inventory | `MANIFEST.md` |

**README sells the idea. USAGE teaches the workflow. INSTALL gets it running. ARCHITECTURE explains the system. DEVELOPMENT explains how to change it. MANIFEST records what currently exists.**

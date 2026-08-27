# KEEL Development Guide

This document is for people who want to modify KEEL itself.

If you only want to use KEEL, start with the [README](../README.md) and [USAGE.md](../USAGE.md).
If you want to understand the architecture, read [ARCHITECTURE.md](ARCHITECTURE.md) first.

---

## 1. The core rule

KEEL is an engineering harness **on top of omp**. Do not turn it into a second coding-agent runtime.

The upstream runtime owns:

- model invocation;
- built-in tools;
- subagent execution;
- sessions and context management;
- LSP integration;
- MCP integration;
- memory;
- configuration merging;
- terminal UI.

KEEL owns the engineering protocol around those primitives:

- task contracts;
- planning and approval;
- mutation scope;
- role separation;
- review handoff;
- acceptance state;
- checkpoints;
- workflow-specific runtime guards.

When a proposed change can be implemented by using an existing omp primitive rather than adding a KEEL mechanism, prefer the omp primitive.

---

## 2. Source of truth

When documentation and implementation disagree, use this order of authority:

1. the running omp behavior and its documented API;
2. `agent/extensions/keel.ts` for mechanical enforcement;
3. the agent frontmatter and instruction files under `agent/`;
4. verification scripts;
5. `MANIFEST.md`;
6. prose documentation.

`MANIFEST.md` is an inventory, not executable policy. It should describe the repository accurately, but a stale manifest must not be treated as a feature specification.

---

## 3. Control documents are state

The workflow deliberately stores important task state on disk rather than only in model context.

Typical state is represented by:

```text
project/
└── docs/
    ├── contract.md
    ├── plan.md
    ├── report.md
    ├── review.md
    └── PHASE_REPORT_<slug>.md
```

These files are not ordinary project documentation while a KEEL task is active. They are part of the harness state machine.

### Ownership

The primary/orchestrator owns the canonical control files.

The coder must not rewrite the contract, plan/SCOPE, task registry, or review verdict. A subagent that can rewrite the document controlling its own scope can bypass the protocol.

Subagents that need to report implementation details use their phase report instead.

---

## 4. The workflow state machine

Do not introduce a new state unless the transition has a concrete enforcement reason.

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
plan
  │
  ▼
plan approval
  │
  ▼
implementation
  │
  ├───────────────┐
  ▼               │
review            │
  │               │
  ├── changes ────┘
  │
  ▼
acceptance
  │
  ▼
verified / closed
```

The exact phase displayed by the status line is derived from durable project state. Do not make the UI status authoritative by itself.

---

## 5. Contracts and plans

A contract answers:

> What must be true when this task is accepted?

A plan answers:

> What will change, where will it change, what is explicitly out of scope, and how will we verify it?

The plan contains the authoritative `SCOPE` block used by the runtime scope guard.

### Never weaken the relationship

Do not make the coder infer scope from prose if a machine-readable scope can be produced.

Do not let the reviewer silently expand scope.

If a requirement changes the scope, the workflow must return to planning rather than silently mutating the existing plan.

---

## 6. Mechanical guards

The runtime extension is deliberately a guard layer, not a second orchestrator.

When adding a guard, answer four questions first:

1. **What invariant is being protected?**
2. **Why is a prompt insufficient?**
3. **What exact tool/action is being intercepted?**
4. **What is the safe behavior when the hook itself fails?**

Prefer narrow predicates over broad heuristics.

A guard should reject the smallest unsafe action rather than disable an entire capability.

### Important guard classes

- plan approval before implementation;
- primary-session code fencing;
- checkpoint creation;
- contract completeness;
- scope locking;
- role/spawn topology;
- single-writer sequencing;
- read-only enforcement;
- control-file protection;
- LSP mutation blocking;
- review handoff integrity;
- acceptance/session-stop enforcement.

### Fail-open vs fail-closed

Do not choose this globally.

For a hook implementation bug, freezing the entire coding session can be worse than allowing the operation and reporting the instrumentation failure. For a missing or unusable security boundary such as an absent scope in a state where scope is mandatory, blocking the mutation is appropriate.

The correct policy belongs to the invariant being protected and should be documented with the guard.

---

## 7. Tool classification

omp may expose more tools than are obvious from an agent's frontmatter. Some tools are derived or added by the runtime.

When changing read-only enforcement:

- inspect the actual omp tool classification;
- do not assume the frontmatter is the complete runtime tool list;
- remember that MCP tools are a separate boundary;
- test direct mutation, shell mutation, LSP mutation, and MCP mutation separately where applicable.

A read-only role is not safe merely because its Markdown says `read`.

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

The primary session controls role creation. A role may use the read-only scout where permitted, but the workflow must not become an unrestricted recursive agent tree.

The coder is the intended project-code writer.

The planner and reviewer may inspect the repository and use read-only LSP operations, but their mutation paths are blocked.

---

## 9. Structured outputs

Planner, reviewer, and coder outputs are protocol messages, not merely prose.

If a field is consumed mechanically, treat its schema as an API.

In particular:

- do not rename fields casually;
- do not parse model prose when a structured field already exists;
- do not let the orchestrator paraphrase a reviewer's required next action when verbatim relay is part of the protocol;
- update all consumers and verification checks together when a schema genuinely changes.

A model that produces valid-looking prose but invalid structured output has not completed the protocol step.

---

## 10. Verification

KEEL's strongest property is that acceptance is not identical to the coder saying `done`.

Verification should prefer evidence from the system being changed:

```text
source change
   ↓
run / inspect real system
   ↓
compare with contract
   ↓
accept or return to coder
```

For UI work, browser/MCP verification is preferred where the contract requires behavior visible in the running application.

For backend work, use the real endpoint, command, database state, integration path, or other observable behavior when practical.

Do not make a green self-authored test the only evidence if the acceptance contract describes a real-world behavior that the test does not exercise.

---

## 11. Adding a new task type

Task types are persisted in the contract because they affect mechanics, not just prompt wording.

When adding one:

1. define its semantics in the task-type documentation;
2. define its required gate/effort behavior;
3. define what evidence is required;
4. implement the runtime behavior;
5. inject the type-specific rules into every relevant role;
6. add verification coverage;
7. update `MANIFEST.md`;
8. update `USAGE.md` only if the user-visible workflow changes.

Do not create a task type that merely changes the tone of a prompt. If it has no enforceable semantic difference, it probably belongs in a skill instead.

---

## 12. Skills vs guards vs instructions

Use the lowest appropriate layer.

### Instruction

Use when the rule is behavioral guidance and a model can safely choose how to follow it.

Examples:

- coding style;
- reasoning heuristics;
- how to structure a report.

### Skill

Use when a reusable procedure should be loaded into selected roles.

Examples:

- surgical coding;
- visual QA;
- decision discipline.

### Runtime guard

Use when violating the rule would invalidate the engineering protocol and the model must not be trusted to self-enforce it.

Examples:

- scope lock;
- control-file ownership;
- LSP mutation blocking;
- single-writer enforcement.

The mistake to avoid is putting every rule into `keel.ts`. That turns a small harness into an unmaintainable second runtime.

---

## 13. Configuration changes

KEEL's config contains both harness-critical settings and user-specific settings.

Do not casually overwrite a user's existing `~/.omp/agent/config.yml`.

The installer should:

- preserve existing files;
- make conflicts explicit;
- never touch credentials stored by omp;
- install KEEL's required files only when safe;
- bootstrap the official omp installation only when omp is missing.

The installer is a bootstrapper, not a configuration merger engine.

If a merge is required, tell the user exactly what must be merged.

---

## 14. Testing a change

Before calling a change complete, test at the smallest level that can falsify the assumption.

### Documentation-only change

- verify links and paths;
- compare statements with current files;
- ensure no command or filename is invented.

### Installer change

- existing omp installation remains untouched;
- missing omp is bootstrapped through the official installer;
- failed omp installation stops before KEEL files are copied;
- existing KEEL files are handled according to the original conflict behavior;
- both Unix and PowerShell paths are considered.

### Agent/config change

- run `verify.sh` / `verify.ps1`;
- ensure no placeholders remain unless deliberately expected;
- verify every referenced skill exists;
- verify every agent path exists;
- inspect the resulting merged configuration where possible.

### Guard change

Test both sides:

```text
allowed operation → passes
forbidden operation → blocked
```

Also test the bypass path that motivated the guard. For example, a file-write restriction is incomplete if `edit` is blocked but shell redirection still writes the file.

---

## 15. Verification scripts

`verify.sh` and `verify.ps1` are intentionally LLM-free.

They should inspect the installed state directly. Do not make verification depend on an AI model being available; otherwise a broken harness can report success merely because the model did not complain.

When adding a required artifact, add a deterministic verification check for it.

A verification check should fail with a useful message that tells the maintainer what is missing and where it is expected.

---

## 16. Debugging

When KEEL appears inactive, debug from the outside inward:

1. Is `omp` running the expected installation?
2. Is the KEEL extension loaded?
3. Are the three instruction layers present in the expected scope?
4. Are the agent files visible to omp?
5. Are the model roles configured?
6. Does the task state exist under `docs/`?
7. Did the relevant tool call reach the guard?
8. Did the guard classify the operation as intended?
9. Did the structured output validate?
10. Did the status UI merely fail to display an otherwise working guard?

Do not start by changing prompts. First establish whether the failure is in runtime loading, state, classification, enforcement, or presentation.

Useful artifacts include:

```text
omp stats
~/.omp/logs/
~/.omp/agent/sessions/*.jsonl
docs/contract.md
docs/plan.md
docs/report.md
docs/review.md
```

---

## 17. Safe evolution rules

KEEL is a harness with a lot of interacting constraints. Prefer small, reversible changes.

Before changing a guard or instruction:

1. identify the invariant;
2. locate the current enforcement point;
3. identify every consumer of the state/field/tool classification;
4. make the smallest change;
5. run deterministic verification;
6. test the intended blocked and allowed paths;
7. update technical documentation;
8. update the manifest last.

Do not rewrite the whole harness to solve a local problem.

Do not add a new abstraction merely to make a one-off change look cleaner.

Do not silently change a safety boundary because a model finds it inconvenient.

---

## 18. Documentation map

| Audience | Start here |
|---|---|
| New user | `README.md` |
| Daily user | `USAGE.md` |
| Installation/troubleshooting | `INSTALL.md` |
| Architecture reader | `docs/ARCHITECTURE.md` |
| Maintainer / contributor | `docs/DEVELOPMENT.md` |
| Exact inventory of current files and guards | `MANIFEST.md` |

The documentation should preserve this separation:

**README sells the idea. USAGE teaches the workflow. INSTALL gets it running. ARCHITECTURE explains the system. DEVELOPMENT explains how to change it. MANIFEST records what currently exists.**

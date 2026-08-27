# Using KEEL

> A practical guide for using KEEL as an engineer.

KEEL is an engineering harness on top of [omp](https://omp.sh/). Start `omp` in the project you want to work on and describe the outcome you want in normal language.

For installation, see [INSTALL.md](INSTALL.md). For the internal design, see [ARCHITECTURE.md](ARCHITECTURE.md). For the current file inventory, see [MANIFEST.md](MANIFEST.md).

---

## 1. Start a session

```bash
cd /path/to/project
omp
```

There is no KEEL project-initialization command. When a task enters the engineering workflow, KEEL creates and maintains its state under the project's `docs/` directory.

A Git repository is strongly recommended because KEEL creates a non-destructive checkpoint before the first mutation:

```text
refs/keel/checkpoint
```

If the project is not a Git worktree, the workflow can still operate, but Git checkpoint/recovery features are unavailable.

---

## 2. Give KEEL a task

Describe the desired outcome, not an implementation plan.

> Add a page showing the latest orders and allow filtering them by date.

You do not need to know which files, endpoints, components, or libraries should change. The orchestrator investigates the repository and asks about decisions that cannot be discovered from the code.

A useful request contains, when known:

- the desired outcome;
- important constraints;
- anything that must not change.

Incomplete requests are fine. Clarifying missing product decisions is part of the workflow.

---

## 3. The workflow

At a high level:

```text
request
  ↓
clarification / brief
  ↓
contract + plan
  ↓
user approval
  ↓
implementation
  ↓
review
  ↓
independent acceptance verification
  ↓
closed
```

The durable state lives on disk rather than only in the conversation. Typical task-state files are:

```text
project/docs/
├── contract.md
├── plan.md
├── report.md
├── review.md
├── decisions.md
└── PHASE_REPORT_<slug>.md
```

This is what allows a compacted or restarted session to recover the task from project state instead of trusting conversational memory.

---

## 4. Human gates

KEEL keeps you out of the mechanical implementation loop while retaining control over consequential decisions.

### Gate 1 — clarify the brief

The orchestrator resolves requirements that only you can decide. Repository facts are investigated by the agents instead of becoming unnecessary questions.

### Gate 2 — approve the plan and contract

The plan describes what will change, what is out of scope, and how acceptance will be demonstrated. The contract describes what must be true when the task is accepted.

The coder does not start until the required approval point is reached. Contract-bound agents also cannot start while unresolved placeholders such as `<...>` or `TBD` remain.

**Review this gate carefully.** Once implementation starts, the approved scope is a runtime-enforced boundary.

### Gate 3 — accept the result

KEEL reports the implementation and evidence collected against the contract. Acceptance is not equivalent to the coder saying `done`.

If acceptance is incomplete, the workflow can return to implementation rather than declaring the task complete.

---

## 5. Implementation vs. acceptance

The coder implements the approved work. It is not the final authority on whether the task is complete.

```text
CODER
  │
  ├── implementation evidence
  ↓
REVIEWER
  │
  ├── accepted → verification
  │
  └── changes required → exact next action
  ↓
CODER
```

The reviewer produces structured output. When another implementation pass is required, KEEL relays the reviewer's next action without asking the orchestrator to paraphrase it.

Final acceptance is checked against the contract and, where required, the real system.

---

## 6. Live verification

KEEL distinguishes implementation evidence from acceptance evidence.

If a task requires a page to display a filtered set of orders, the strongest evidence is the running application displaying the correct result — not merely source code that appears to implement the filter.

Depending on the project, acceptance may use:

- a real HTTP endpoint;
- a running application;
- browser/MCP interaction;
- database state;
- a CLI command;
- an integration path;
- another observable system behavior.

For frontend tasks, the `visual-tooling` skill can be injected when the contract requires browser-based verification.

A self-authored test is useful evidence, but it is not automatically equivalent to real-system acceptance.

---

## 7. Scope is a hard boundary

The approved plan contains a machine-readable `SCOPE` block. KEEL checks mutations against that scope, including relevant paths through:

- `edit` / `write`;
- shell-based writes;
- LSP mutation actions;
- identifiable MCP mutation targets.

An agent cannot decide that an additional file would be "better" and expand the scope itself.

If the requirement changes, return to planning and change the contract/plan through the normal approval path.

**Scope is enforced by the runtime, not merely requested in prose.**

---

## 8. Agent roles

| Role | Purpose | Project-code writes |
|---|---|---:|
| Orchestrator | Owns workflow and canonical control documents | No |
| Planner | Repository analysis, plan, and contract | No |
| Coder | Approved implementation | **Yes** |
| Reviewer | Independent review and next-action decision | No |
| Designer | Read-only UI/UX exploration | No |
| Scout | Cheap read-only repository reconnaissance | No |

The runtime topology is constrained. The primary session can create role agents; role agents may use the read-only scout where permitted. KEEL does not allow an unrestricted recursive tree of agents or multiple concurrent writers for the same task.

---

## 9. Read-only work

Not every request needs implementation.

Questions such as:

- What framework is this project using?
- Where is authentication configured?
- What is the current folder structure?
- Which component renders this page?

can be answered without modifying the project.

Read-only reconnaissance and design work do not become implementation merely because KEEL is installed. When project mutation begins, the engineering workflow and its gates apply.

---

## 10. Working between tasks

Task state belongs to project files; conversational context is disposable.

Use omp's normal session controls between or during tasks:

```text
/clear
/compact
/handoff
```

These are omp features. KEEL relies on the underlying runtime and durable project state rather than implementing a second session system.

---

## 11. Checkpoints and recovery

In a Git worktree, KEEL creates a checkpoint before the first mutation:

```text
refs/keel/checkpoint
```

It is created with `git stash create`, which does not modify the working tree or stash list.

Inspect it with:

```bash
git diff refs/keel/checkpoint
```

Restore an individual path when necessary with:

```bash
git checkout refs/keel/checkpoint -- path/to/file
```

Normal Git history remains the primary recovery mechanism. The KEEL checkpoint is an additional pre-change restore point, not a replacement for commits.

---

## 12. Multiple tasks

After completing a task, give KEEL another one normally. Task state is tracked in the project's control documents, including `docs/report.md`.

Each task gets its own contract, scope, review, and acceptance state. An unfinished task should not be hidden behind a later task being marked complete.

Starting the next task from a clean conversational context is usually the simplest workflow.

---

## 13. Safety boundaries

KEEL combines:

- omp's native tool and agent boundaries;
- instruction-level invariants;
- runtime guards in `keel.ts`;
- shell safety patterns in `config.yml`;
- contract and scope gates;
- control-file ownership;
- single-writer sequencing;
- acceptance/session-stop enforcement.

The extension also protects its own enforcement layer from being rewritten by a live session.

KEEL does not treat prompts alone as a security boundary.

---

## 14. Monitoring

| What you want | Where |
|---|---|
| Token/cost/model usage | `omp stats` |
| Live subagents | `Alt+A` / Agent Hub |
| Session replay | `~/.omp/agent/sessions/*.jsonl` |
| Runtime logs | `~/.omp/logs/` |
| Current task state | project `docs/` |

The exact UI and runtime commands belong to omp and may evolve independently of KEEL.

---

## 15. Changing models

Model selection is left to the user. KEEL's role configuration contains placeholders that must be replaced during installation.

When changing a model, verify that planner/reviewer/coder roles still produce the structured outputs consumed by the harness. These fields are protocol data, not optional formatting.

For model changes, run the repository's smoke evaluation described by `docs-templates/smoke-eval.md` when applicable, then run the deterministic verifier.

---

## 16. Troubleshooting

### KEEL does not appear to be active

Check that the extension exists in the configured omp agent directory:

```text
~/.omp/agent/extensions/keel.ts
```

or under the custom `OMP_AGENT_DIR`.

Then run:

```bash
./verify.sh
```

Windows:

```powershell
./verify.ps1
```

### The coder will not start

Check that:

1. `docs/contract.md` exists;
2. the contract has no unresolved placeholders;
3. `docs/plan.md` contains a usable `SCOPE` block;
4. the plan reached the required approval gate;
5. configured model IDs are valid and available.

### A mutation is blocked

Read the block reason. Common causes are:

- the target is outside `SCOPE`;
- the current role is read-only;
- the operation is an LSP mutation;
- a control file is owned by the primary session;
- another writer is active;
- the task type forbids the operation.

Do not bypass the guard. If the requirement changed, update the contract and plan through the workflow.

### Verification cannot complete

Inspect the exact evidence and failure returned by the real system. KEEL is designed to return the task to implementation when acceptance evidence does not match the contract.

---

## 17. What KEEL cannot know

KEEL cannot verify a requirement that was never defined and could not be inferred from the repository.

A harness can make explicit requirements difficult to lose, enforce scope, and require evidence. It cannot invent product decisions that the user never made.

The plan/contract approval point is therefore where you confirm what "correct" means.

---

## 18. Documentation map

- [Installation](INSTALL.md)
- [Architecture](ARCHITECTURE.md)
- [Development guide](DEVELOPMENT.md)
- [Manifest](MANIFEST.md)
- [Project README](../README.md)
- [Upstream omp](https://omp.sh/)

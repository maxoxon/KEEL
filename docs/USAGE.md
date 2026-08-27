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

The normal implementation path is:

```text
request
  ↓
clarification / brief
  ↓
contract
  ↓
plan + SCOPE
  ↓
REVIEWER · Gate #1
  ↓
user approval
  ↓
implementation
  ↓
conditional REVIEWER · Gate #2
  ├── revise → coder
  └── pass
  ↓
independent acceptance verification
  ↓
closed
```

Gate #1 and Gate #2 are different checks:

- **Gate #1 — pre-code review.** The reviewer checks the contract and plan before implementation. It checks completeness, dependencies/blast radius, scope, over-engineering, real-data acceptance criteria, and coherence between fields. It then writes the exact `next_prompt` for the coder. fileciteturn39file0L2-L2
- **Gate #2 — conditional implementation review.** The reviewer does not re-review every coder pass. It is triggered when native checks fail twice, behavior cannot be auto-checked, the diff is large (roughly more than six files), or a sensitive area changed. When triggered, it reads the actual diff and audits it against the plan, evidence, verification state, and scope. fileciteturn39file0L2-L2

The reviewer is not a second coder. It has no edit/write/bash tools and returns a structured verdict. The extension relays its `next_prompt` to the coder verbatim when another implementation pass is required. fileciteturn39file0L2-L2

The reviewer also does **not** drive the browser MCP. UI live verification is performed by the contract-bound implementation path when `visual-tooling` is injected; the shipped `mcp.json` specifically configures the browser MCP for the coder. The reviewer remains a code/plan gatekeeper and may request a browser run through `needs` when it cannot perform that action itself.

---

## 4. Human gates

KEEL keeps you out of the mechanical implementation loop while retaining control over consequential decisions.

### Gate A — clarify the brief

The orchestrator resolves requirements that only you can decide. Repository facts are investigated by the agents instead of becoming unnecessary questions.

### Gate B — review and approve the plan

The reviewer first checks the plan and contract. After that review, KEEL asks for the explicit implementation approval immediately before the coder starts. The approval is a runtime gate, not a model instruction.

The coder cannot start while the contract is missing, unresolved, the plan has no usable `SCOPE`, or the approval gate has not passed.

### Gate C — accept the result

KEEL reports the implementation and evidence collected against the contract. Acceptance is not equivalent to the coder saying `done`.

If acceptance is incomplete, the workflow returns to implementation rather than declaring the task complete.

---

## 5. Implementation vs. acceptance

The coder implements the approved work. It is not the final authority on whether the task is complete.

```text
PLAN
  │
  ▼
REVIEWER · Gate #1
  │
  ▼
USER APPROVAL
  │
  ▼
CODER
  │
  ├── implementation evidence
  ▼
[conditional REVIEWER · Gate #2]
  │
  ├── revise → exact next action → CODER
  └── pass
          │
          ▼
INDEPENDENT ACCEPTANCE
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
- browser/MCP interaction through the contract-bound implementation path;
- database state;
- a CLI command;
- an integration path;
- another observable system behavior.

For frontend tasks, the `visual-tooling` skill can be injected when the contract requires browser-based verification.

A self-authored test is useful evidence, but it is not automatically equivalent to real-system acceptance.

---

## 7. Scope is a hard boundary

The approved plan contains a machine-readable `SCOPE` block. KEEL checks mutations against that scope, including relevant paths through:

- `edit` / `write` / `ast_edit`;
- shell-based writes through `bash` / `eval`;
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
| Reviewer | Gate #1 on plan; conditional Gate #2 on implementation | No |
| Designer | Read-only UI/UX exploration | No |
| Scout | Cheap read-only repository reconnaissance | No |

The runtime topology is constrained. The primary session can create role agents; role agents may use the read-only scout where permitted. KEEL does not allow an unrestricted recursive tree of agents or multiple concurrent writers for the same task.

One important nuance: the reviewer is read-only with respect to project code, but it **does not have browser/MCP tools in its declared tool set**. UI live verification is handled by the contract-bound implementation path, where `visual-tooling` and the configured browser MCP can be used. Planner, designer, and scout are the strictly read-only roles enforced by KEEL's runtime guard.

---

## 9. Task types

The active task type is stored in `docs/contract.md` as `Тип:` and changes runtime mechanics rather than merely changing prompt wording.

| Type | Current behavior |
|---|---|
| `bug-fix` | Root-cause debugging with the debugger; smallest safe fix |
| `small-feature` | Smallest safe extension of existing behavior |
| `large-feature` | Mandatory milestone decomposition and per-milestone verification |
| `refactor` | Preserve behavior; verify before and after |
| `architecture-change` | Explicit rationale, dependencies, rollback points, staged compatibility |
| `new-project` | MVP-first, independently verifiable milestones |
| `audit` | Read-only audit; coder is mechanically refused |
| `adopt` | Describe an existing project from filesystem evidence without rewriting it |

Task type also selects the per-spawn `effort` hint and injects type-specific rules into contract-bound agents. `audit` additionally disables the coder path. Large/architectural types require a real milestone ledger before coding.

---

## 10. Read-only work

Not every request needs implementation.

Questions such as:

- What framework is this project using?
- Where is authentication configured?
- What is the current folder structure?
- Which component renders this page?

can be answered without modifying the project.

Read-only reconnaissance and design work do not become implementation merely because KEEL is installed. When project mutation begins, the engineering workflow and its gates apply.

---

## 11. Working between tasks

Task state belongs to project files; conversational context is disposable.

Use omp's normal session controls between or during tasks:

```text
/clear
/compact
/handoff
```

These are omp features. KEEL relies on the underlying runtime and durable project state rather than implementing a second session system.

---

## 12. Checkpoints and recovery

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

## 13. Multiple tasks

After completing a task, give KEEL another one normally. Task state is tracked in the project's control documents, including `docs/report.md`.

Each task gets its own contract, scope, review, and acceptance state. An unfinished task should not be hidden behind a later task being marked complete.

Starting the next task from a clean conversational context is usually the simplest workflow.

---

## 14. Safety boundaries

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

## 15. Monitoring

| What you want | Where |
|---|---|
| Token/cost/model usage | `omp stats` |
| Live subagents | `Alt+A` / Agent Hub |
| Session replay | `~/.omp/agent/sessions/*.jsonl` |
| Runtime logs | `~/.omp/logs/` |
| Current task state | project `docs/` |

The exact UI and runtime commands belong to omp and may evolve independently of KEEL.

---

## 16. Changing models

Model selection is left to the user. KEEL's role configuration contains placeholders that must be replaced during installation.

When changing a model, verify that planner/reviewer/coder roles still produce the structured outputs consumed by the harness. These fields are protocol data, not optional formatting.

For model changes, run the repository's smoke evaluation described by `docs-templates/smoke-eval.md` when applicable, then run the deterministic verifier.

---

## 17. Troubleshooting

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
4. Gate #1 has run for the current plan;
5. the implementation approval was confirmed;
6. configured model IDs are valid and available.

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

## 18. What KEEL cannot know

KEEL cannot verify a requirement that was never defined and could not be inferred from the repository.

A harness can make explicit requirements difficult to lose, enforce scope, and require evidence. It cannot invent product decisions that the user never made.

The plan/contract approval point is therefore where you confirm what "correct" means.

---

## 19. Documentation map

- [Installation](INSTALL.md)
- [Architecture](ARCHITECTURE.md)
- [Development guide](DEVELOPMENT.md)
- [Manifest](MANIFEST.md)
- [Project README](../README.md)
- [Upstream omp](https://omp.sh/)

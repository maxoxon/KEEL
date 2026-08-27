# KEEL Architecture

> Technical documentation for people who want to understand, audit, extend, or debug KEEL rather than merely use it.

KEEL is an engineering harness built on top of [omp](https://omp.sh/). It does not replace the coding-agent runtime. omp supplies the runtime primitives — sessions, tools, subagents, LSP, MCP, memory, extensions, and model routing — while KEEL adds an opinionated engineering protocol and mechanical enforcement around those primitives.

This document describes the implementation model as it exists in the repository. It is deliberately more detailed than the README and is intended to be read alongside `MANIFEST.md` and the source under `agent/`.

---

## 1. Design thesis

The central KEEL assumption is:

> If an engineering rule matters, it should not exist only as a prompt.

A language model can forget an instruction, reinterpret it, lose context after compaction, or decide that a shortcut is justified. KEEL therefore separates responsibilities into three layers:

1. **Prompt/instruction layer** — tells agents what they are supposed to do.
2. **omp runtime layer** — provides tool and agent primitives and applies its own configuration semantics.
3. **KEEL enforcement layer** — observes tool calls and lifecycle events and blocks or modifies unsafe transitions.

The result is intentionally redundant. A rule can be explained to the model and independently enforced by the harness.

```text
                    USER INTENT
                         |
                         v
              +----------------------+
              | KEEL instruction     |
              | / contract / plan    |
              +----------+-----------+
                         |
                         v
              +----------------------+
              | omp runtime           |
              | models / tools / task |
              | sessions / MCP / LSP  |
              +----------+-----------+
                         |
                         v
              +----------------------+
              | KEEL extension       |
              | lifecycle + guards   |
              +----------------------+
                         |
                         v
                 PROJECT STATE
```

KEEL is therefore closer to a **control plane** than to another agent.

---

## 2. Repository layout

The repository has three important categories of material.

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
│   └── ARCHITECTURE.md
├── docs-templates/
├── tests/
├── install.sh
├── install.ps1
├── verify.sh
├── verify.ps1
├── INSTALL.md
├── USAGE.md
├── MANIFEST.md
└── README.md
```

The `agent/` tree is the installable harness. The installer places it under `~/.omp/agent/` (or the configured `OMP_AGENT_DIR`). `docs/` in this repository contains developer-facing documentation; `docs/` inside a project is runtime state created by KEEL during a task.

That distinction is important: **repository `docs/` is documentation; project `docs/` is task state.**

---

## 3. Instruction reach: why there are three instruction files

omp does not give every session the same instruction context. KEEL relies on that behavior rather than pretending every file reaches every agent.

### `AGENTS.md` — primary-only persona

`AGENTS.md` defines the orchestrator's role and operating posture. omp filters it out of structured subagent context.

It is therefore appropriate for information that belongs to the primary session: orchestration, calibration of user questions, and the high-level identity of the five roles.

### `APPEND_SYSTEM.md` — primary-only harness operation

This contains the operational description of the KEEL pipeline: phases, state transitions, stop points, memory/compaction behavior, parallelism, skills, and what to do when blocked.

omp's task executor does not forward this append-system prompt to subagents. This is intentional. A subagent gets its own role document plus the shared hard rules rather than inheriting the entire orchestrator protocol.

### `RULES.md` — cross-agent invariants

`RULES.md` is the shared invariant layer. omp forwards the configured rules to subagents and treats them as always-applicable.

Rules belong here when violating them would undermine the system regardless of role: no mocks when live verification is required, never invent facts, respect decomposition, do not bypass the pipeline, and similar invariants.

### The consequence

Every agent definition must be **self-sufficient**. A coder cannot depend on `APPEND_SYSTEM.md` magically appearing in its context.

This is one of the easiest mistakes to make when modifying KEEL: changing a primary instruction and assuming the same text is now visible to subagents.

---

## 4. Agent topology

KEEL uses five roles around the primary session.

```text
                         PRIMARY
                     ORCHESTRATOR
                           |
          +----------------+----------------+
          |                |                |
       PLANNER           SCOUT           DESIGNER
          |
       approval
          |
        CODER
          |
       REVIEWER
          |
          +------> next coder action
```

### Orchestrator

Owns the workflow and the control documents. It does not write product code.

### Planner

Reads the repository and produces the plan and acceptance contract. It may use LSP for navigation, but LSP mutation is blocked by KEEL.

### Coder

The only role intended to mutate product code. It receives the approved contract and scope and reports structured completion evidence.

### Reviewer

Independently evaluates the implementation and produces a structured verdict plus the exact next instruction for the coder when work remains.

### Designer

Read-only visual/UX exploration. It does not implement the result.

### Scout

Cheap, read-only reconnaissance. Other agents can use it for repository discovery without turning every investigation into another writer.

The topology is mechanically constrained: the primary can spawn role agents; a role agent can spawn only the read-only scout. This prevents recursive agent trees and prevents parallel writers from appearing accidentally.

---

## 5. The task state machine

KEEL does not treat the chat transcript as the source of truth. The project filesystem is the durable state machine.

A simplified lifecycle is:

```text
REQUEST
   |
   v
BRIEF / CLARIFICATION
   |
   v
CONTRACT + PLAN
   |
   v
USER APPROVAL
   |
   v
IMPLEMENTATION
   |
   v
REVIEW
   |       \
   |        \ reject / changes required
   |         +-----------> IMPLEMENTATION
   v
INDEPENDENT VERIFICATION
   |
   +---- fail ----> IMPLEMENTATION
   |
   v
ACCEPTED
```

The actual state is reconstructed from files such as:

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

This makes `/clear`, compaction, or a fresh session survivable. The next primary session can inspect the same state instead of trusting conversational memory.

---

## 6. Contract and scope are security boundaries

Two artifacts are particularly important.

### `docs/contract.md`

The contract defines what success means. Contract-bound agents (`coder` and `reviewer`) cannot be spawned until the file exists and unresolved placeholders such as `<...>` or `TBD` have been removed.

The extension also injects the contract into the task payload sent to those agents. This avoids relying on the orchestrator to paste the right version manually.

### `docs/plan.md`

The plan contains the implementation plan and a machine-readable `SCOPE` section. The scope is the set of existing files/resources the task is allowed to mutate.

The critical property is ownership:

> The coder can use the scope, but it cannot redefine the scope.

Changing scope requires going back through planning and the user approval gate.

The scope check covers more than ordinary file writes. KEEL also considers shell writes, LSP mutation attempts, and identifiable MCP targets so that changing the interface used to mutate something does not trivially bypass the boundary.

---

## 7. Mechanical guards

The extension in `agent/extensions/keel.ts` is the enforcement layer. The source currently implements the following families of guards.

### 7.1 Plan gate

The coder cannot start until the user confirms the plan. This is the principal human approval point.

### 7.2 Primary code fence

The orchestrator may write only the KEEL control documents it owns. Product code and product artifacts are blocked even if the orchestrator tries to reach them indirectly.

The guard covers:

- `edit`
- `write`
- `ast_edit`
- shell commands that write to disk

This matters because a guard that protects `write` but permits `bash 'cat > file'` is not actually a boundary.

### 7.3 Checkpoint

Before the first mutation in a git worktree, KEEL creates a non-destructive restore point using `git stash create` and stores the resulting object under:

```text
refs/keel/checkpoint
```

`git stash create` does not modify the working tree or stash list. It gives KEEL a stable reference that can be inspected later.

### 7.4 Loud errors and empty artifacts

Failed tool calls are annotated so the model cannot casually treat them as successful work. Likewise, a command that exits successfully but produces no expected artifact is made visible as an empty artifact condition.

### 7.5 Systemic contract gate

Coder/reviewer spawns require a valid contract. This turns a convention into a precondition.

### 7.6 Scope lock

Mutations outside the declared scope are blocked. In a harness project, absence of a usable scope is treated conservatively rather than as permission to write anywhere.

### 7.7 Verbatim review relay

The reviewer's `next_prompt` is captured from structured output and delivered to the coder through the extension. The orchestrator does not paraphrase it.

This is deliberately mechanical: paraphrasing a review introduces another model interpretation between the reviewer and the implementer.

The relay is consumed once. A stale review cannot remain queued and unexpectedly reappear later.

### 7.8 Spawn topology

KEEL validates every agent in a task call, including omp's batched task shape. The extension supports both:

```text
{ agent, task }
```

and the default batched shape:

```text
{ context, tasks: [{ agent, task, name }] }
```

This is important because a guard that only reads the top-level `agent` field silently fails when omp uses batching.

### 7.9 Acceptance gate

`session_stop` prevents the primary session from settling while the final acceptance checklist is still open after real work has begun. Pushback is capped so a broken model cannot create an infinite loop.

### 7.10 Milestone decomposition

Large task types — `large-feature`, `architecture-change`, and `new-project` — require a milestone ledger before coding begins. Size is therefore represented as durable state rather than a model's vague judgement.

### 7.11 Harness self-protection

A live session cannot rewrite its own enforcement layer, agent definitions, `RULES.md`, or core config. Otherwise a constrained agent could simply delete the rule that constrained it.

Changes to the harness itself are expected to happen from the terminal or through a separate, explicitly scoped engineering task.

### 7.12 Control-file ownership

Subagents cannot write the orchestrator's control files. In particular:

- coder cannot widen `docs/plan.md` scope;
- coder cannot forge `docs/review.md`;
- reviewer cannot rewrite the contract it is judging;
- subagent reports go into `PHASE_REPORT_<slug>.md`.

### 7.13 Task type

`Тип:` in the contract resolves to a known task type. The type changes mechanics — rules injected into spawns, effort level, and whether the coder is allowed at all for an audit — rather than merely changing wording.

### 7.14 Read-only enforcement

Planner, designer, and scout are blocked from tools that are not recognised as read operations. This is particularly important for MCP because an agent's normal `tools:` allowlist describes omp built-ins; MCP tools can otherwise be exposed separately.

### 7.15 One writer at a time

KEEL prevents a task call from running two coders concurrently, a coder alongside its reviewer, or a second coder while the first is still active. Read-only scouts can fan out.

### 7.16 LSP write protection

LSP remains available for navigation and diagnostics, but mutation actions such as rename, file rename, and applied code actions are blocked. The coder uses the ordinary edit/write path, where checkpoint and scope enforcement apply.

---

## 8. Why the extension observes tool calls

The extension is not a second agent. It is a runtime policy layer.

Conceptually it observes:

```text
model -> tool_call -> KEEL hook -> omp tool execution
                         |
                         +--> allow
                         +--> block + reason
                         +--> rewrite input

omp tool result -> KEEL hook -> model-visible result
```

The extension uses omp's hook API. For `tool_call`, a hook can block a call with a reason or return replacement input. For `tool_result`, KEEL can annotate what the model sees.

This allows KEEL to enforce policy without requiring a privileged second model to police the first one.

---

## 9. Structured output is part of the protocol

KEEL relies on structured agent outputs where a downstream stage needs a machine-readable decision.

Examples include:

```text
planner  -> plan + contract
reviewer -> verdict + next_prompt
coder    -> contract_met + evidence + did_not_verify + remaining
```

The point is not aesthetic JSON. The structure is what lets the runtime safely consume a decision without asking another model to reinterpret prose.

When adding or changing a field, check all three layers:

1. the agent's output schema/instructions;
2. the consumer in `keel.ts` or the orchestrator;
3. the verifier/tests that prove the field is actually used.

A field that exists only in a prompt is not a protocol field.

---

## 10. Task types

Task type is stored in the contract so it survives context loss.

| Type | Typical gate level | Intent |
|---|---:|---|
| `bug-fix` | 1 | Establish root cause and make the smallest safe fix |
| `small-feature` | 1 | Extend existing behavior with minimal surface area |
| `large-feature` | 3 | Implement in explicit milestones and verify each one |
| `refactor` | 1 | Preserve behavior while changing structure |
| `architecture-change` | 3 | Make architecture decisions explicit and reversible |
| `new-project` | 3 | Establish a new system in verified increments |
| `audit` | special | Inspect and report; do not hand implementation to the coder |

The exact operational rules live in the harness instructions and extension. This table is the conceptual model, not a substitute for source-level behavior.

---

## 11. Skills

Skills are stored one level deep:

```text
~/.omp/agent/skills/<name>/SKILL.md
```

omp injects `autoloadSkills` for agents that declare them. KEEL uses skills to package reusable engineering behavior instead of expanding every agent prompt indefinitely.

Current roles include skills for:

- surgical/minimal coding;
- evidence-based decisions;
- worktree freshness;
- agent briefing;
- visual tooling;
- project-state handling;
- conservative design principles.

A subtle but important property: the primary orchestrator is not an ordinary subagent, so its operating material belongs in `APPEND_SYSTEM.md` rather than `autoloadSkills`.

---

## 12. Configuration model

KEEL installs its configuration into omp's user agent directory. The important distinction is between **harness-critical settings** and **user-owned model settings**.

`config.yml` contains model-role placeholders and harness behavior such as memory, compaction, LSP, approval mode, and shell safety patterns.

Model IDs are deliberately left for the user to choose. KEEL should not silently impose a commercial provider or a particular model.

omp's configuration layering is conceptually:

```text
built-in defaults
      < user config (~/.omp/agent)
      < project config (.omp)
      < overlay
```

Project configuration can therefore override user configuration. Credentials are not intended to be stored in `config.yml`; authentication belongs to omp's credential mechanisms.

---

## 13. Live verification

KEEL distinguishes **implementation evidence** from **acceptance evidence**.

A coder saying:

> "the endpoint should work"

is not acceptance evidence.

A green test written by the same coder is useful engineering evidence, but KEEL's final acceptance contract is checked independently by the orchestrator.

For frontend work, the visual tooling path can use browser MCP to exercise the running application. This is why `mcp.json`, `visual-tooling`, and the `Frontend` contract field exist together.

The philosophy is:

```text
source code says it should work
            |
            v
       run the system
            |
            v
       observe reality
            |
            v
       compare to contract
```

Live verification is not a promise that every possible production failure can be detected. It is a deliberate attempt to move acceptance from static plausibility toward observable behavior.

---

## 14. Failure and retry model

KEEL expects implementation and review to be iterative.

```text
CODE
  |
  v
REVIEW
  |
  +---- approved ----> VERIFY
  |
  +---- changes -----> CODE
                         |
                         +---- repeat
```

The implementation loop is bounded. A task that repeatedly hits the same wall must eventually surface the blocker instead of becoming an autonomous infinite repair loop.

Similarly, acceptance pushback is bounded. The system should fail visibly and ask for a new decision rather than consume unlimited tokens trying to satisfy an impossible state.

---

## 15. Checkpoints and recovery

The checkpoint is intentionally non-destructive.

Before mutation:

```bash
git stash create
```

produces an object representing the current worktree state. KEEL stores it as:

```text
refs/keel/checkpoint
```

Useful inspection commands are:

```bash
git diff refs/keel/checkpoint
git diff --stat refs/keel/checkpoint
```

A file can be restored selectively with the normal git mechanisms. KEEL does not automatically destroy the user's working tree to create the checkpoint.

This is a safety net, not a replacement for commits.

---

## 16. Why state lives on disk

Conversation history is a poor database for engineering state.

It can be:

- compacted;
- cleared;
- truncated;
- transferred to another session;
- polluted by unrelated discussion;
- inaccessible to a different agent.

KEEL therefore writes durable state into project documents. The harness can derive the current phase from those files on a later turn.

This also makes the process auditable. A human can inspect the contract, plan, review, decisions, and evidence without replaying the entire model conversation.

---

## 17. Verification architecture

`verify.sh` and `verify.ps1` intentionally do not ask an LLM whether KEEL is installed correctly.

They inspect the actual filesystem and validate structural invariants such as:

- expected files exist;
- agent frontmatter is present;
- skill references resolve;
- critical configuration values are present;
- the extension is installed;
- required guards and markers exist;
- the installation layout matches what omp expects.

This creates a useful separation:

```text
install
  |
  v
static verifier  ----> "is the harness installed?"
  |
  v
runtime           ----> "does the workflow enforce itself?"
  |
  v
smoke evaluation  ----> "does the chosen model/provider behave correctly?"
```

A static verifier cannot prove model behavior. A model smoke test cannot prove that the file layout is correct. Both are necessary.

---

## 18. Extending KEEL safely

When adding a new guard, use this sequence.

### 1. Define the invariant

Write the rule as a statement that can be observed or falsified.

Bad:

> "The coder should be careful."

Good:

> "A coder mutation whose target is outside `SCOPE` is blocked."

### 2. Identify the bypass surface

If you protect `write`, ask whether the same mutation can happen through:

- `edit`;
- `ast_edit`;
- `bash`;
- `eval`;
- LSP mutation;
- MCP;
- another agent.

A guard is only useful if the alternate path is either protected or deliberately allowed.

### 3. Keep user interaction minimal

The plan gate is the intentional human decision point. Most other guards should push back on the model, not interrupt the user.

### 4. Make state explicit

If a rule depends on previous work, prefer a file, structured result, or runtime state with a clear lifetime over a string hidden in conversation history.

### 5. Add a negative test

Do not only prove that the intended path works. Prove that the forbidden path is blocked.

### 6. Update the manifest

`MANIFEST.md` is the inventory. This architecture document explains why the pieces exist; the manifest should tell you exactly what exists and where.

---

## 19. Failure modes worth preserving

Some behavior that looks conservative is deliberate.

### Fail-open extension errors

The extension is designed not to freeze a session if its own hook code encounters an unexpected error. This avoids turning a bug in the harness into a deadlocked coding environment.

That trade-off means the verifier and tests are especially important: a broken guard must be detected during development rather than silently trusted at runtime.

### No automatic scope expansion

If implementation discovers that the plan was incomplete, KEEL should re-plan rather than silently widen scope. This protects the meaning of the user's approval.

### No fake completion

A missing verification result is different from a failed verification result, and both are different from a passing result. The acceptance state must preserve that distinction.

### No recursive writers

The topology is intentionally restrictive. More autonomous agents do not automatically mean a better engineering system; uncontrolled writers make ownership and scope much harder to reason about.

---

## 20. Source of truth when documentation and code disagree

For implementation details, the source wins.

Recommended order when investigating a discrepancy:

1. `agent/extensions/keel.ts` for mechanical enforcement;
2. the relevant agent frontmatter and prompt under `agent/agents/`;
3. `agent/RULES.md` / `APPEND_SYSTEM.md` / `AGENTS.md` for intended behavior;
4. `verify.sh` / `verify.ps1` for installation invariants;
5. `MANIFEST.md` for the inventory;
6. this document for the architectural explanation;
7. `README.md` for the public product-level description.

If a change in omp invalidates an assumption, update the implementation and verification first, then update the documentation.

---

## 21. Relationship to omp

KEEL intentionally tracks omp behavior instead of cloning the runtime.

When debugging a KEEL issue, first ask which layer owns the behavior:

| Symptom | First place to inspect |
|---|---|
| tool does not exist | omp |
| agent cannot see a file/instruction | omp context construction + KEEL agent config |
| model routing is wrong | omp config/model provider |
| forbidden mutation was allowed | `agent/extensions/keel.ts` |
| wrong role received a task | task topology + extension |
| state disappeared after compaction | project `docs/` + state derivation |
| installer copied the wrong layout | installer + omp expected layout |
| installation is structurally incomplete | `verify.sh` / `verify.ps1` |
| model ignores a role instruction | agent prompt/skill + smoke evaluation |

This boundary is a feature. KEEL should not become an alternative implementation of the entire omp runtime.

---

## 22. Practical debugging checklist

When a workflow behaves unexpectedly:

```text
1. What phase does docs/report.md say we are in?
2. Does docs/contract.md exist and contain a resolved Type?
3. Does docs/plan.md contain the expected SCOPE?
4. Which exact agent was spawned?
5. Was the task call batched?
6. Which tool produced the unexpected mutation?
7. Was it a built-in tool, shell command, LSP mutation, or MCP action?
8. Which guard should have seen it?
9. Did the hook return an error or fail open?
10. Does verify.sh/verify.ps1 still pass?
11. Is the behavior actually owned by omp rather than KEEL?
```

For runtime debugging, inspect the session JSONL and omp logs as described in `USAGE.md`.

---

## 23. The mental model

The shortest accurate description of the implementation is:

```text
omp gives KEEL the ability to:
    think
    read
    write
    execute
    delegate
    inspect
    remember

KEEL decides:
    who may do what
    when they may do it
    what they are allowed to touch
    what evidence is required
    when a stage may transition
    when the system must stop
```

That separation is the core architecture.

KEEL does not attempt to make a model infallible. It attempts to make **important engineering transitions explicit, durable, observable, and mechanically constrained**.

# KEEL Architecture

> Technical documentation for people who want to understand, audit, extend, or debug KEEL rather than merely use it.

KEEL is an engineering harness built on top of [omp](https://omp.sh/). It does not replace the coding-agent runtime. omp supplies the runtime primitives — sessions, tools, subagents, LSP, MCP, memory, extensions, configuration, model routing, and terminal UI — while KEEL adds an opinionated engineering protocol and mechanical enforcement around those primitives.

This document describes the implementation model represented by the repository's agent definitions, `agent/extensions/keel.ts`, installers, verification scripts, templates, and technical documentation. When this document disagrees with code, the code wins.

---

## 1. Architectural thesis

The central KEEL assumption is:

> **If an engineering rule matters, it should not exist only as a prompt.**

A language model can forget an instruction, reinterpret it, lose context after compaction, or decide that a shortcut is justified. KEEL therefore separates responsibilities into three layers:

1. **Instruction layer** — tells agents what they are supposed to do.
2. **omp runtime layer** — provides tools, agents, sessions, context, LSP, MCP, memory, model routing, and extension lifecycle.
3. **KEEL enforcement layer** — observes tool calls and lifecycle events and blocks or rewrites unsafe transitions.

The result is deliberately redundant. A rule can be explained to the model and independently enforced by the harness.

```text
                         USER INTENT
                              │
                              ▼
                    ┌───────────────────┐
                    │ KEEL instructions │
                    │ contract / plan   │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │    omp runtime    │
                    │ tools / agents    │
                    │ sessions / MCP    │
                    │ LSP / memory      │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ KEEL extension    │
                    │ lifecycle + guards│
                    └─────────┬─────────┘
                              │
                              ▼
                       PROJECT STATE
```

KEEL is therefore closer to a **control plane** than to another coding agent.

---

## 2. What KEEL owns — and what omp owns

The boundary is intentional.

### omp owns

- model invocation and provider routing;
- built-in tools and their native permission tiers;
- task/subagent execution;
- sessions, compaction, branching, and handoff;
- LSP and MCP infrastructure;
- memory and configuration merging;
- terminal UI and runtime lifecycle;
- extension loading and hook/event dispatch.

### KEEL owns

- task contracts and acceptance criteria;
- task typing;
- planning and machine-readable scope;
- the human plan-approval gate;
- role separation and spawn topology;
- mutation scope enforcement;
- control-file ownership;
- pre-change checkpoints;
- review handoff integrity;
- single-writer sequencing;
- task-state and acceptance enforcement;
- workflow-specific runtime guards.

KEEL should use an omp primitive when one already exists instead of reimplementing it.

---

## 3. Instruction reach

omp does not give every session the same instruction context. KEEL deliberately uses three instruction layers.

### `agent/AGENTS.md` — primary-only persona

Defines the orchestrator's identity, operating posture, role map, and user-facing language. omp filters this primary material out of structured subagent context.

### `agent/APPEND_SYSTEM.md` — primary-only harness operation

Defines how the orchestrator runs the pipeline: intake, planning, review, approval, implementation, verification, state handling, parallelism, compaction, and handoff behavior. It is not forwarded wholesale to subagents.

### `agent/RULES.md` — shared invariants

Contains cross-agent rules that must survive role boundaries: evidence over status, no mocks in done, decomposition, no invented facts, and stop-on-repeated-blocker behavior.

The consequence is important:

> **Every agent definition must be self-sufficient.**

A coder cannot depend on `APPEND_SYSTEM.md` magically appearing in its context. The role file and shared rules are the agent's actual instruction surface.

---

## 4. Agent topology

KEEL ships five role agents around the primary session.

```text
                              PRIMARY
                           ORCHESTRATOR
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
          PLANNER             SCOUT             DESIGNER
             │
             ▼
       CONTRACT + PLAN
             │
             ▼
       REVIEWER · GATE #1
             │
             ▼
          APPROVAL
             │
             ▼
           CODER
             │
             ▼
       IMPLEMENTATION
             │
             ├───────────────┐
             ▼               │
       REVIEWER · GATE #2    │
        conditional          │
             │               │
        ┌────┴────┐          │
        ▼         ▼          │
      REVISE     PASS        │
        │         │          │
        └───► CODER          │
                  │          │
                  └──────────┘
                       │
                       ▼
              INDEPENDENT VERIFY
                       │
                       ▼
                    ACCEPTED
```

The **primary session** is the orchestrator and is not a normal role-agent file.

### Orchestrator

Owns the workflow and canonical control documents. It does not write product code or product artifacts. Its allowed writes are the project control documents under `docs/`:

- `contract.md`
- `plan.md`
- `report.md`
- `review.md`
- `decisions.md`
- `PHASE_REPORT_<slug>.md`

The extension enforces this code fence for both normal file tools and shell-based writes.

### Planner

Read-only. Produces the plan and doneness contract. It declares the authoritative `SCOPE` block and lists affected files. The orchestrator writes the planner's result into project state.

### Coder

The only role intended to mutate project code. It receives the contract, type rules, approved scope, and — when required — the reviewer's exact next instruction. It returns structured evidence.

### Reviewer

A read-only project-code gatekeeper with two distinct jobs:

- **Gate #1, before code:** reviews the contract and plan for completeness, dependency/blast-radius sanity, scope, over-engineering, real-data acceptance criteria, and coherence between fields. It returns a structured verdict and `next_prompt`.
- **Gate #2, after code, conditionally:** re-enters only when a native check failed twice, behavior cannot be auto-checked, the diff is larger than roughly six files, or a sensitive zone changed. It reads the actual diff, audits evidence and scope, and either passes, requests revision, or escalates.

The reviewer has no `edit`, `write`, `bash`, or browser/MCP tools in its declared tool set. It is a code/plan gatekeeper, not the browser driver. When an external check is required, it can return a structured `needs` item for the caller to run.

### Designer

Read-only UI/UX exploration. It proposes concepts, screen states, and flows; it never implements them.

### Scout

Fast, cheap, read-only repository reconnaissance. It answers narrow factual questions with file/line evidence and can map broad code paths when explicitly asked.

### Spawn topology

The primary can spawn role agents. A role agent can spawn only `scout`. No role agent can recursively create another writer or summon its own reviewer.

This topology is enforced in `keel.ts`, including batched omp task calls.

---

## 5. The real workflow state machine

The high-level lifecycle is:

```text
REQUEST
   │
   ▼
BRIEF / CLARIFICATION
   │
   ▼
CONTRACT
   │
   ▼
PLAN + SCOPE
   │
   ▼
REVIEWER · GATE #1
   │
   ▼
USER APPROVAL
   │
   ▼
IMPLEMENTATION
   │
   ├─────────────────────────────┐
   ▼                             │
CONDITIONAL REVIEW · GATE #2    │
   │                             │
   ├── revise ───────────────────┘
   │
   ▼
INDEPENDENT ACCEPTANCE
   │
   ├── fail ───────────────► IMPLEMENTATION
   │
   ▼
ACCEPTED / CLOSED
```

The second review is **conditional**, not a mandatory step after every coder run. The reviewer agent is explicit that repeated native-check failure, uncheckable behavior, large diffs, and sensitive zones trigger it.

The implementation loop is bounded. Repeated mechanical blocks eventually escalate rather than causing an infinite autonomous loop.

---

## 6. Durable task state

KEEL does not treat the chat transcript as the source of truth. Project state lives on disk:

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

### `contract.md`

Defines what success means and contains the task type plus frontend/backend/wiring/success-criterion fields.

### `plan.md`

Defines milestones, affected files, and the authoritative machine-readable `SCOPE` block.

### `report.md`

Contains the task ledger, milestone ledger, implementation round count, blockers, and final acceptance checklist. An open task row is what gives the current plan active force; when all tasks are closed, the old plan is not allowed to constrain the next task.

### `review.md`

A stamped courtesy copy of the reviewer's captured `next_prompt`. The runtime's in-memory relay is the load-bearing path; the file exists so a human can inspect what was relayed and so the current plan can be identified after restart.

### `decisions.md`

Durable engineering decisions and rationale. It prevents important choices from existing only in model memory.

### `PHASE_REPORT_<slug>.md`

Per-session/subagent findings. These are not substitutes for the canonical contract, plan, report, or review state.

This separation makes `/clear`, compaction, and fresh sessions survivable.

---

## 7. Contract and scope are boundaries

Two artifacts are particularly important.

### Contract

Contract-bound agents (`coder` and `reviewer`) cannot be spawned until `docs/contract.md` exists and contains no unresolved placeholders. The extension injects the contract into their task payload so the agent does not depend on the orchestrator remembering to paste it.

### Scope

The planner's `SCOPE` block defines what the active task may touch.

```text
<!-- SCOPE -->
- src/orders/Filter.tsx
- api/routes/orders.py
- assets/ui/table.png
<!-- END SCOPE -->
```

The scope is enforced against:

- `edit` / `write` / `ast_edit`;
- shell writes through `bash` / `eval`;
- LSP mutation actions;
- identifiable MCP targets.

The guard is intentionally fail-closed when an active task has no usable scope. Scope is not widened by the orchestrator or coder; it is changed through replanning.

The scope matcher normalizes path separators and collapses `.` / `..` traversal before comparison. Broad entries such as `.`, `*`, `**`, `src`, `app`, and `project` are rejected as unusably broad.

---

## 8. Review protocol and verbatim handoff

The reviewer output is structured:

```text
reviewer
  ├── verdict: pass | revise | escalate
  ├── next_prompt: exact next instruction for coder
  ├── findings: optional structured findings
  └── needs: optional actions only the caller can perform
```

When Gate #1 or conditional Gate #2 requires coder action, the extension captures `next_prompt` from the blocking reviewer result and injects it into the coder task **verbatim**. The orchestrator does not paraphrase it.

The relay is consumed once. A stale review cannot remain queued and unexpectedly reappear later.

The review file is stamped with a content fingerprint of the plan so a review of an older plan cannot satisfy the gate for a newly written plan.

---

## 9. Mechanical enforcement

`agent/extensions/keel.ts` is the enforcement layer. The current implementation contains these guard families.

### 9.1 Plan approval gate

Before the coder starts, the interactive primary session asks the user to approve the reviewed plan. A rejected approval blocks the coder. Headless runs still seed the acceptance ledger, but do not invent a UI confirmation.

### 9.2 Primary-session code fence

The orchestrator may write only the canonical control documents under project `docs/`. It cannot write product code, product docs, data, or assets directly. The same boundary applies to shell redirects and other shell write paths.

### 9.3 Checkpoint

Before the first mutation in a Git worktree, KEEL uses `git stash create` and stores the resulting object at:

```text
refs/keel/checkpoint
```

This is non-destructive: the working tree, index, and stash list are not modified.

### 9.4 Loud tool failures

Failed tool calls are annotated so a model cannot casually treat an error as missing data or success.

### 9.5 Empty-artifact visibility

Commands that appear successful but produce no expected artifact are surfaced as an empty-artifact condition rather than being treated as proof of success.

### 9.6 Systemic contract gate

`coder` and `reviewer` cannot start without a resolved contract.

### 9.7 Unresolved-placeholder gate

Open placeholders in the contract (`<...>`, `TBD`, `???` patterns supported by the runtime) prevent contract-bound spawns.

### 9.8 Scope lock

Active mutations are checked against the planner's `SCOPE`. Unknown or unidentifiable mutation targets are not automatically treated as harmless when they can affect a project resource.

### 9.9 Verbatim review relay

The reviewer's `next_prompt` is captured and injected without paraphrase.

### 9.10 Spawn topology

The extension checks every agent in a task call, including omp's batched `{ context, tasks: [...] }` shape. Only the primary may choose arbitrary role agents; subagents may spawn only `scout`.

### 9.11 Acceptance/session-stop guard

After real work has mutated the session, `session_stop` prevents the primary from settling while the final acceptance checklist still has open items. The extension caps its pushbacks so it cannot trap a session forever.

### 9.12 Milestone decomposition

`large-feature`, `architecture-change`, and `new-project` require a populated milestone ledger before the coder starts. The runtime checks the durable ledger rather than trusting a prompt saying "decompose first".

### 9.13 Harness self-protection

A live session cannot rewrite its installed `keel.ts`, agent definitions, `RULES.md`, or core config through the normal harness path. The enforcement mechanism cannot be editable by the agents it constrains.

Harness development therefore happens from a terminal or from the KEEL repository as an ordinary, separately scoped engineering task.

### 9.14 Control-file ownership

Subagents cannot rewrite the orchestrator's contract, plan/SCOPE, report, review, or decisions. This prevents a coder from widening its own scope or forging its own review state.

### 9.15 Task-type mechanics

`Тип:` in `docs/contract.md` must resolve to a known type. The type selects rules and per-spawn `effort`, and `audit` refuses the coder entirely.

### 9.16 Strict read-only enforcement

Planner, designer, and scout are blocked from tools that are not recognized as read-only. The reviewer is a separate gatekeeper role: it has no project-write tools, but is not the browser driver and is not treated as one of the strict read-only roles.

MCP is a separate tool boundary. Browser/MCP verification belongs to the contract-bound implementation path; the reviewer can request an external check through `needs` but cannot drive the browser itself.

### 9.17 Single writer

The primary cannot launch two coders concurrently, cannot launch a coder alongside the reviewer that judges it, and cannot start another coder while one is active. Read-only scouts may fan out.

### 9.18 LSP write protection

LSP remains available for navigation and diagnostics. Rename/file-rename and applied code actions are treated as mutations and blocked for read-only roles; the coder is expected to mutate through `edit` / `write` / `ast_edit`, where checkpoint and scope enforcement apply.

---

## 10. Shell and MCP mutation surfaces

A central design rule is:

> **Protect the mutation, not only the tool name.**

### Shell

`bash` and `eval` are universal execution surfaces. KEEL therefore detects write intent rather than blocking all shell commands.

The detector covers common POSIX writes such as `rm`, `mv`, `cp`, `tee`, `ln`, `touch`, `mkdir`, redirects, in-place edits, and inline interpreter writes. It also recognizes PowerShell and Windows command forms.

Package-manager installs such as `npm install` or `pip install` are deliberately treated differently from direct project writes because dependency installation is ordinary engineering work.

### MCP

MCP tools can target actors, assets, scene objects, or remote resources that do not look like filesystem paths. KEEL extracts identifiable target fields such as `actor`, `asset`, `object`, `target`, and related path fields and feeds them into the scope check where possible.

A tool with no identifiable target — for example a browser navigation action — cannot always be path-scoped. The runtime therefore combines target-aware scope enforcement with role-specific restrictions and the review/verification workflow rather than pretending every MCP action is a file write.

---

## 11. Task types

Task type is persisted in the contract because it changes mechanics.

| Type | Runtime behavior |
|---|---|
| `bug-fix` | High effort; root cause must be established with the debugger; smallest safe fix |
| `small-feature` | Medium effort; smallest safe extension |
| `large-feature` | High effort; milestone decomposition and per-milestone verification |
| `refactor` | High effort; behavior-preservation checks before and after |
| `architecture-change` | High effort; rationale, dependencies, rollback points, staged compatibility |
| `new-project` | Medium effort; MVP-first independently verifiable milestones |
| `audit` | High effort; read-only; coder is mechanically refused |
| `adopt` | Medium effort; describe an existing project from filesystem evidence without rewriting it |

The source contains a `gates` field in the task-type data structure, but the current runtime's concrete human approval mechanism is the single plan-approval confirmation immediately before coder execution. Documentation must not describe unused gate-count metadata as a second or third active confirmation flow.

---

## 12. Structured output as protocol

KEEL relies on structured output wherever a downstream stage needs a machine-readable decision.

```text
planner  → plan + contract
reviewer → verdict + next_prompt
coder    → contract_met + evidence + did_not_verify + remaining
```

The important fields are not cosmetic. A field that exists only in a prompt but is not consumed or verified is not a protocol field.

When changing a schema, update:

1. the producing agent;
2. the consumer in the extension/orchestrator;
3. deterministic verification/tests;
4. technical documentation if the behavior is user-visible.

---

## 13. Live verification and acceptance

KEEL distinguishes **implementation evidence** from **acceptance evidence**.

A coder can report that a command returned `0`, a test passed, or an endpoint returned `200`. Those are useful signals, but the cross-agent invariant is that status is not state.

The acceptance contract should be checked against observable reality:

```text
source code
    │
    ▼
run the real system
    │
    ▼
read the resulting state
    │
    ▼
compare with contract
    │
    ▼
accept / return to implementation
```

For frontend work, the extension points the contract-bound implementation path at `skill://visual-tooling` when the contract contains a real frontend section. That procedure requires browser interaction and real output rather than source-code inspection as UI proof. The shipped `mcp.json` configures the browser MCP for that implementation path; the reviewer does not drive the browser.

---

## 14. Skills

Skills are stored exactly one level below the skill root:

```text
~/.omp/agent/skills/<name>/SKILL.md
```

omp injects `autoloadSkills` before an agent's first prompt when a role declares them. KEEL uses skills to package reusable discipline without turning every agent definition into a giant prompt.

Current shipped skills:

- `karpathy` — coder discipline before implementation;
- `surgical-coding` — smallest correct change;
- `ponytail` — avoid unnecessary construction;
- `worktree-freshness` — do not infer absence from a stale checkout;
- `decision-guard` — judge decisions from evidence;
- `agent-brief` — structured coder briefs and completion criteria;
- `visual-tooling` — browser-based UI verification procedure;
- `project-state` — durable task state, compaction, and session continuity guidance.

The `designer` role intentionally has no permanent autoloaded skill in the shipped definition.

The repository's `tests/doc-conformance.sh` checks the assumptions KEEL makes about omp's skill discovery and precedence against a local omp source tree.

---

## 15. Configuration model

`agent/config.yml` contains harness-critical settings plus model-role placeholders.

Important areas include:

- `modelRoles`;
- mnemopi memory;
- automatic image routing to the `vision` role;
- compaction;
- LSP and AST grep;
- effort support;
- `yolo` peripheral approval behavior;
- shell safety patterns;
- provider isolation.

The coder model is intentionally pinned in `agent/agents/coder.md` rather than being a natural role alias. The shipped value is `KEEL_SETUP_REQUIRED` and must be replaced with a strict-schema model during setup.

`agent/models.yml` is intentionally minimal. OpenRouter is a built-in omp provider, so a custom provider block is not required for normal OpenRouter usage.

`agent/mcp.json` configures the browser MCP entry point used by UI verification. Its presence does not prove the external MCP command is available or functioning.

Credentials belong to omp's authentication mechanism, not KEEL configuration files.

---

## 16. Installation architecture

KEEL is not a separate executable runtime. The installers place its configuration, role definitions, skills, MCP configuration, and extension into omp's agent directory:

```text
~/.omp/agent/
├── AGENTS.md
├── APPEND_SYSTEM.md
├── RULES.md
├── config.yml
├── models.yml
├── mcp.json
├── agents/
├── extensions/
└── skills/
```

The installer first checks for `omp`.

```text
check omp
   │
   ├── found ───────────────► keep existing omp
   │
   └── missing
         │
         ▼
   run official omp installer
         │
         ├── failure ───────► stop; do not install KEEL
         │
         └── success
                │
                ▼
          verify omp is available
                │
                ▼
          install KEEL layer
```

Existing differing destination files are not silently overwritten. The installer reports `skip` and asks the user to merge manually.

---

## 17. Verification architecture

There are two distinct deterministic verification layers.

### Installation verifier

`verify.sh` / `verify.ps1` inspect the installed filesystem and check required files, model placeholders, agent identity, extension guard markers, skills, configuration, shell-write detection, and other structural invariants.

They do not ask an LLM whether installation succeeded.

### Upstream conformance check

`tests/doc-conformance.sh` takes a local omp source checkout and checks that KEEL's assumptions about hooks, task agents, skills, config layering, context reach, and approval behavior still match the upstream runtime/documentation.

This is separate because the install verifier must work without an omp source checkout, while conformance testing explicitly depends on one.

### Runtime smoke evaluation

`docs-templates/smoke-eval.md` defines live behavioral checks for model swaps: routing, reviewer read-only behavior, done-report discipline, image routing, and the plan approval gate.

A static verifier cannot prove model behavior. A model smoke test cannot prove filesystem layout. Both are necessary.

---

## 18. Checkpoints and recovery

The checkpoint is intentionally non-destructive.

```bash
git stash create
git update-ref refs/keel/checkpoint <sha>
```

KEEL's implementation performs the equivalent programmatically. `git stash create` does not change the working tree, index, or stash list.

Useful inspection:

```bash
git diff refs/keel/checkpoint
git diff --stat refs/keel/checkpoint
```

The checkpoint is a safety net, not a replacement for normal commits.

---

## 19. Failure and retry model

KEEL deliberately distinguishes:

```text
blocked
  ≠ failed
  ≠ unverified
  ≠ passed
```

If the same mechanical wall is hit repeatedly, the orchestrator is instructed to stop spinning and ask the user what is needed. Review/implementation loops are bounded. Acceptance pushback is also bounded.

The extension is designed to fail open if its own hook code throws unexpectedly. That avoids freezing the coding environment because of a harness bug, but it makes deterministic verification and negative runtime tests important: a silently broken guard must be caught during development.

---

## 20. Extending KEEL safely

When adding a new guard:

1. define the invariant as something observable and falsifiable;
2. identify every bypass surface (`edit`, `write`, `ast_edit`, shell, LSP, MCP, other agents);
3. decide which part belongs in instructions/skills and which part must be mechanical;
4. implement the narrowest safe predicate;
5. add a negative test for the forbidden path;
6. add an allowed-path test so the guard does not become a blanket denial;
7. update the manifest and technical documentation.

A useful invariant is:

> "A coder mutation whose target is outside SCOPE is blocked."

A weak invariant is:

> "The coder should be careful."

---

## 21. Practical debugging checklist

When a workflow behaves unexpectedly:

```text
1. What phase does docs/report.md say we are in?
2. Does docs/contract.md exist and contain a resolved Type?
3. Does docs/plan.md contain the expected SCOPE?
4. Has the current plan passed reviewer Gate #1?
5. Has the user approval gate passed?
6. Which exact agent was spawned?
7. Was the task call batched?
8. Which tool produced the unexpected mutation?
9. Was it a built-in tool, shell command, LSP mutation, or MCP action?
10. Which guard should have seen it?
11. Did the hook return an error or fail open?
12. Does verify.sh/verify.ps1 still pass?
13. Is the behavior actually owned by omp rather than KEEL?
```

For runtime debugging, inspect `omp stats`, session JSONL, and `~/.omp/logs/` as described in `USAGE.md`.

---

## 22. Relationship to omp

When debugging KEEL, first ask which layer owns the behavior:

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

## 23. Source of truth

For implementation details, use this order:

1. actual omp runtime/API behavior;
2. `agent/extensions/keel.ts` for mechanical enforcement;
3. agent frontmatter and instruction files;
4. `verify.sh` / `verify.ps1`;
5. `tests/doc-conformance.sh` when the claim depends on upstream omp behavior;
6. `MANIFEST.md`;
7. prose documentation.

If a change in omp invalidates an assumption, update implementation and verification first, then update this document.

---

## 24. Mental model

The shortest accurate description is:

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

KEEL does not attempt to make a model infallible. It attempts to make **important engineering transitions explicit, durable, observable, and mechanically constrained**.

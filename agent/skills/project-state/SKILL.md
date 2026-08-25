---
name: project-state
description: Where every KEEL document lives, who may write it, and how it is kept compact. The authoritative path map for the harness - read this before creating, moving or pruning any project document.
---

# Project State - the document map

Project documentation is working memory. It must stay **accurate, compact and
synchronised**, and it describes the CURRENT state of the project, never its history.

Everything lives in `docs/` at the project root. **Never create a project document
outside this list.** If you think you need a new one, you need a section in an existing
one instead.

## The map

| Document | Path | Written by | Class |
|---|---|---|---|
| Doneness contract | `docs/contract.md` | orchestrator only | structural |
| Plan + SCOPE block | `docs/plan.md` | orchestrator (content comes from the planner) | structural |
| Task ledger + acceptance | `docs/report.md` | orchestrator only | transient |
| Reviewer verdict | `docs/review.md` | written by the extension automatically | transient |
| Engineering decisions | `docs/decisions.md` | orchestrator | append-pruned |
| Phase report | `docs/PHASE_REPORT_<slug>.md` | the subagent that produced it | transient |

Blank templates for the first five ship in `docs-templates/` of the harness
repository - copy, do not invent a layout.

Two rules the extension enforces mechanically, so do not test them:

- The orchestrator may write ONLY the files above marked "orchestrator". Everything
  else - code, product docs, data, assets - goes through the coder.
- `docs/plan.md` carries the SCOPE block between `<!-- SCOPE -->` and
  `<!-- END SCOPE -->`. It is written by the planner and changed only by re-planning.

## Phase reports and parallel sessions

Several KEEL sessions may run against the same project at once (separate terminals,
separate worktrees). Two distinct risks follow.

**Phase reports are per-session output.** Always write to
`docs/PHASE_REPORT_<slug>.md`, choosing a short descriptive slug from the task itself
(`PHASE_REPORT_cart-bug.md`, `PHASE_REPORT_export-csv.md`). Never the bare
`docs/PHASE_REPORT.md` - a shared filename silently overwrites when two sessions
finish near each other.

**Cumulative documents are shared.** `report.md`, `decisions.md`, `contract.md` and
`plan.md` must never be overwritten wholesale from memory. Before writing:

1. Re-read the current on-disk state immediately before writing - not a copy you held
   from earlier in the session; another session may have changed it since.
2. Merge your changes into that state. Touch only the sections you own (your ledger
   row, your decision entry). Never reconstruct the whole file from your own memory.
3. If another session changed the exact section you are about to change, surface the
   conflict rather than silently picking a version.

## Compaction - by class, not by one hard rule

Compaction always comes before expansion. A single limit for every document causes
structural findings to be deleted as if they were status updates, so the rule differs
by class.

**Transient (`report.md`, `review.md`, phase reports)** - hard limit 150 lines,
always enforced. Remove anything superseded by newer status. Nothing else should be
citing transient content as a permanent source, so no promotion is needed first.

**Structural (`contract.md`, `plan.md`)** - 150 lines is a review trigger, not a
delete trigger. Remove an item only if BOTH hold: (a) it is fully superseded by a newer
decision or a completed milestone, AND (b) nothing else references it. If the document
is over the limit and nothing qualifies, let it exceed and note it in `report.md` as
"docs/<file> over soft limit, review needed".

**Append-pruned (`decisions.md`)** - no line count. Pruned only by deleting decisions
explicitly superseded by a newer one. Never summarised or shortened: a decision is
either live or gone.

## Promote before compact

Before removing any finding, constraint or risk during compaction, check whether
another document references it - explicitly ("see report.md") or implicitly (a contract
field derived from an earlier analysis).

If it is referenced: move the content into the referencing document first, then
compact the source. A reference is only valid if the target actually contains what it
points at; leaving a pointer to information that no longer exists is a broken
reference and must be fixed like any other.

The safe moment to drop a structural finding is after the milestone that depended on it
has been implemented and verified - at that point it is closed history, not an active
constraint.

## Rules

- Never create new project documentation files.
- Never duplicate the same information across documents.
- Replace outdated information instead of appending to it.
- Keep documents synchronised with the current state; remove conflicting information.
- Remove broken references, including references to findings dropped during compaction.
- Report every document you updated.

## Guiding principle

Working memory should get smaller, cleaner and more accurate over time - but never by
silently deleting something another document still depends on.

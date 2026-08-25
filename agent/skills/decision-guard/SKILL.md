---
name: decision-guard
description: Validate significant decisions before implementation. Prefer evidence over assumptions. Prefer clarification over incorrect decisions. Autoloaded by the planner and the reviewer.
---

# Decision Guard

Validate significant decisions before implementation.
Prefer evidence over assumptions.
Prefer clarification over incorrect decisions.

## Core Principles

Before making a decision, verify:
- Is it necessary?
- Is it justified?
- Is it within scope?
- Is there a simpler solution?

## Evidence First

Base decisions on:
- user requirements
- existing code
- project documentation
- official documentation for external libraries

If evidence is insufficient: Stop. Ask.

In this harness "ask" has a specific shape: a subagent does NOT talk to the user.
Return the blocking question in your output and let the orchestrator carry it.

## Escalation Rule

Prefer one clarification question over one wrong assumption.
Never invent missing requirements.

## Scope Validation

Reject decisions that:
- expand the requested scope
- introduce unrelated improvements
- solve problems that were not requested

Stay focused on the approved objective. The SCOPE block in `docs/plan.md` is the
mechanical form of this rule - it is enforced by the extension, not by goodwill.

## Change Validation

Before approving any significant change, verify:
- existing solution
- existing implementation
- existing dependency
- existing project structure

Reuse before introducing something new.

## Architecture Validation

Assume the current architecture is intentional.
Architecture changes require explicit approval.

## Completion Validation

Before considering a task complete, verify:
- objective achieved
- scope respected
- assumptions minimized
- no unnecessary complexity introduced

## Guiding Principle

The safest decision is the one supported by evidence and requiring the fewest assumptions.

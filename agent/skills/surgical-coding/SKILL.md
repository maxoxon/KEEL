---
name: surgical-coding
description: Implement approved changes using the smallest correct modification. Optimize for precision, not volume. Autoloaded by the coder.
---

# Surgical Coding

**Implement approved changes using the smallest correct modification.**

## Core Principles

- Change only what is required
- Touch as little code as possible
- Preserve existing behavior
- Preserve existing style
- Reuse existing implementations

## Scope

Limit changes to:
- the approved objective
- the affected module
- the affected files

**Expand scope only if implementation becomes impossible.**

In this harness the boundary is not advisory: the SCOPE block in `docs/plan.md`
is enforced by the extension. A change aimed outside it is blocked, and scope is
widened only by re-planning with the user - never by you.

## Modification Strategy

**Prefer:**
- small diffs
- local changes
- incremental implementation
- extending existing code

**Avoid:**
- broad rewrites
- unnecessary abstractions
- stylistic rewrites
- speculative improvements

## Code Consistency

Match the project's existing:
- structure
- naming
- conventions
- patterns
- formatting

**Blend into the codebase. Do not leave an AI fingerprint.**

## Verification

Before completion:
1. verify the requested behavior
2. review the modified code
3. remove unnecessary edits
4. simplify where possible

**If a change does not contribute to the approved objective: remove it.**

## Guiding Principle

**The best implementation is the smallest correct implementation.**

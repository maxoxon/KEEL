---
name: worktree-freshness
description: Verify worktree freshness before structural conclusions
---

# Worktree Freshness — Mandatory Pre-Check

Before any structural conclusion based on direct observation, verify worktree freshness first. This is mandatory regardless of confidence.

1. **Identify context** — determine whether you are in an isolated worktree or the main checkout.
2. **Compare HEAD hashes** — if in an isolated worktree, run `git log -1 --format=%H` in the current worktree and in the main checkout. If they match, proceed.
3. **Inspect structural changes** — if hashes differ, run `git log <worktree-hash>..<main-hash> --stat` (or vice versa depending on direction) to review what structural changes exist between the two before concluding anything about what the codebase does or does not contain.
4. **Exclude drift first** — commit hash divergence is the first thing to exclude before assuming an architecture problem, a bug, a mismatch, or that something is missing.

A stale worktree produces false conclusions. Always disprove staleness before diagnosing the code.

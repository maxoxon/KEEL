---
name: agent-brief
description: How to write the brief you hand another agent - Context, Constraints, Composition - plus the intern test and the "don't finish until" stopping condition. Used by the orchestrator when it dispatches, and autoloaded by the reviewer, whose next_prompt is itself a brief.
---

# Writing a brief for an agent

An agent is not a chatbot. A chatbot answers a question; an agent goes and works -
it reads files, edits code, runs commands, opens a browser, and iterates for a long
time before coming back. That difference is why a one-sentence instruction fails: the
agent will not ask the questions it should ask, it will guess, and you find out an
hour later that it guessed wrong.

So you do not write a prompt. You write a **brief**, with three parts.

> Framework credit: the three-part shape and the "don't finish until" phrasing come
> from Matt Shumer's guide to prompting agents (somethingbig.ai/prompting-ai-agents).
> Adapted here to KEEL's roles and enforced artefacts.

## 1. Context - what it needs to know, and where the material is

Everything needed to do the job, plus access to the actual material: the files, the
repo area, the previous version, the relevant docs, the data. Not just the goal - the
location of the things.

The common failure is under-contexting: asking for a refactor without pointing at the
existing tests, asking for an analysis without naming the file or the decision it is
meant to inform. The agent then guesses.

**The intern test.** Imagine handing this brief to a competent intern on their first
day. Could they start working without coming back to ask you anything? If yes, the
brief is probably complete. If no, the agent has exactly the same questions - it just
will not ask them.

In this harness a lot of context is supplied mechanically, and you should not
duplicate it: the extension injects `docs/contract.md` into every contract-bound
agent, and relays the reviewer's verdict to the coder verbatim. What you add is the
part only you know: which files, which prior version, which area of the repo.

## 2. Constraints - including how the work verifies itself

This is where briefing an agent diverges most from prompting a chatbot. Constraints
are not only rules about the answer; they describe **how the agent checks its own work
and what counts as done**.

A weak constraint is "don't make things up." A real one is a stopping condition:

- After the change, run the checks that were passing before; anything that broke is
  yours to fix before you report back.
- Before declaring done, list everything you did NOT verify - and then verify it.
- If you are unsure, say so explicitly instead of picking the most plausible guess.
- Reproduce the failure first; the fix is done when the reproduction passes.

Agents rarely produce obviously wrong work. They produce plausible work and announce
completion: the refactor that compiled and broke three tests nobody re-ran, the summary
whose citations do not say what was claimed. In each case verification was skipped, not
failed. Make verification part of the work rather than an afterthought.

**The highest-leverage phrase is "don't finish until."** It changes what done means:
without it, the agent is done when it has produced something; with it, the agent is
done when it has produced something *and confirmed it is correct*. Almost all agent
failure lives in that gap.

KEEL enforces the same idea mechanically - the acceptance checklist in
`docs/report.md` must be closed before a session can settle - but the phrase still
belongs in the brief, because the checklist says *that* it must be verified while the
brief says *how*.

## 3. Composition - the exact shape of the deliverable

The most underrated part. Left unspecified, the agent defaults to whatever shape the
model has seen most often, which is rarely what you want. Format changes thinking:
asked for "an analysis" it writes paragraphs; asked for "a root cause, the affected
files, the smallest safe fix, and the risks" it structures the work that way while
doing it.

State the shape: the sections, the table, the field names, the length. Where an agent
has an `output:` schema in its frontmatter, that schema *is* the composition - fill it,
do not invent a different shape alongside it.

## The template

```
Context:
  [situation, goal, audience]
  [the files, repo area, prior version, docs it will touch]

Task:
  [the specific thing to produce or do]

Constraints:
  [rules that bound the work]

Don't finish until:
  [the check that must pass]
  [the thing that must be confirmed by running it, not by reading it]

Output format:
  [the shape of the deliverable]
```

## Why this matters more for agents than for chat

A sloppy chatbot answer is visible in seconds. A sloppy agent merges the change, sends
the report, ships the deck. The mistakes have real surface area, so the brief has to
carry more weight: enough context to do the job, enough verification to trust the
result, enough structure that the deliverable is usable.

The skill is less "prompt engineering" than task specification - writing for someone who
can do real work but has never met your team, does not know your prior decisions, and
does not know what done looks like to you.

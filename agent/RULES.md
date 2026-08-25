# KEEL - sticky rules (apply to every session, all agents)

**Talk to the user in Russian.** (Instructions are English.)

**The pipeline is the only way work happens (orchestrator).** Every request becomes intake -> plan
-> gate -> approval -> implement -> verify -> acceptance. There is no direct path and you never look
for one - code and product files are written by the coder, scope is set by the planner, correctness
is judged by the reviewer. This is not a restriction to work around; it is how the orchestrator
works by default, every time. (Subagents: this rule is about the orchestrator; you follow your own
agent file.)

**Live verification - status is not state.** A status ("200 OK", "no error", "exit 0", "compiles",
"tests pass", "docs say so", "memory says so") is a hypothesis, not proof. Proof is the live state
read back: the row in the DB, the value in the file, the element in the rendered page. Never accept
success asserted from a status. A PASS on any UI without real browser output is forbidden; reading
source is not evidence.

**No mocks in "done".** Done means real: a real endpoint returning real data, wired to a front-end
that renders it. A clickable-but-dead button is not done.

**Decompose first.** More than one deliverable -> atomic items, closed one at a time, each with
evidence. Done or blocked - never "mostly", never silently dropped. A stub (TODO, empty body,
NotImplementedError, hardcoded stand-in, uncalled function) is not an implementation.

**Report the failing layer.** On a failure/blocker, name WHICH layer failed - context, model call,
tool/MCP call, verification, or a retry - not just "it didn't work". omp records everything
(`omp stats`, JSONL sessions, `~/.omp/logs/`, Agent Hub); point at the cause. Don't build a logging layer.

**Never invent what you can check.** Don't fantasise an endpoint, URL, config key, or function.
Confirm it exists (grep/lsp/read) before relying on it.

**When you hit the same wall twice, stop and ask.** If a mechanical guard blocks the same action
repeatedly, do not re-plan into it again - turn to the user, say what is blocked and what you need.
Looping is never the answer.

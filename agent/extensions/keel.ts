/**
 * KEEL - mechanical guards for omp. ~/.omp/agent/extensions/keel.ts (autodiscovered).
 *
 * Verified against the omp source (can1357/oh-my-pi, 17.3.x/18.x) - not memory:
 *   - hook factory shape + `pi.on("tool_call")` returning { block, reason } | { input }, and
 *     `pi.on("tool_result")` returning { content } to rewrite what the model sees
 *     (docs/hooks.md, extensibility/extensions/types.ts).
 *   - `tool_call.input` for the `task` tool is the RAW params object. With `task.batch` (default
 *     true) that is `{ context, tasks: [{ agent, task, name }] }`; with batch off it is the flat
 *     `{ agent, task }`. Every guard below reads BOTH shapes (see collectAgents / eachTaskItem).
 *   - `tool_call` may return `{ input }` to replace the RAW execution arguments (revalidated against
 *     the tool schema). That is how the contract + verbatim review are injected into `tasks[i].task`.
 *   - reviewer/planner are pinned `blocking: true` in their frontmatter, so their result arrives in
 *     THIS `task` tool_result (sync), not later as an async job follow-up - which is what makes the
 *     verbatim relay actually capturable (docs/task-agent-discovery.md, task/index.ts sync path).
 *   - `session_stop` exists, is awaited before settle, never fires for subagents, and the platform
 *     caps continuations (session/agent-session.ts). ctx.ui.confirm / ctx.ui.setStatus per docs/hooks.md.
 *   - Instruction reach, verified: AGENTS.md is FILTERED OUT of subagent context
 *     (task/structured-subagent.ts) and APPEND_SYSTEM.md is never forwarded to subagent sessions
 *     (task/executor.ts) - both are PRIMARY-ONLY. Only RULES.md (`rules:`) reaches subagents, where
 *     omp forces alwaysApply. Hence the split: orchestrator persona in AGENTS.md, harness operation
 *     in APPEND_SYSTEM.md, hard cross-agent invariants in RULES.md, and each agent body must be
 *     self-sufficient because neither AGENTS.md nor APPEND_SYSTEM.md reaches it.
 *   - There is no `delete` and no `move` tool in omp. The mutating surface is write / edit / ast_edit
 *     (workspace-write tier) plus bash / eval (exec tier, shell-capable). MUTATING reflects that.
 *
 * Seventeen guards. Only the plan gate ever asks the user anything; the rest push back on the MODEL.
 * (The status bar and the one-time first-run setup message also address the user, but neither
 * blocks or asks - see FIRST RUN below.) Guards:
 *   1. PLAN GATE   - the coder cannot start until the user confirms the plan (one confirm per plan).
 *   2. CODE FENCE  - the primary (orchestrator) writes only the four control docs, never code and
 *                    never product artifacts. Enforced for write/edit/ast_edit AND for shell writes
 *                    (bash/eval), so it cannot be walked around with `cat > file`.
 *   3. CHECKPOINT  - a restore point is captured before the first mutation.
 *   4. LOUD ERRORS - a failed tool call is annotated so it cannot be skimmed past or swallowed.
 *   5. EMPTY ARTIFACT - "exit 0 with no output" is annotated: trust the artifact, not the exit code.
 *   6. CONTRACT IS SYSTEMIC - a contract-bound agent (coder, reviewer) cannot be spawned before
 *      docs/contract.md exists and is free of open placeholders; the contract text is injected into
 *      its task so it never depends on the orchestrator remembering to paste it.
 *   7. SCOPE LOCK - the plan declares what may be touched; a mutating call (file OR MCP tool OR shell
 *      write) aimed at anything already-existing outside that scope is blocked. The scope is set by
 *      the PLANNER and changed only by re-planning with the user - never widened by the orchestrator.
 *   8. VERBATIM REVIEW RELAY - the reviewer's instruction reaches the coder through the extension,
 *      not the orchestrator's paraphrase. Held in memory, consumed once, so a stale verdict can never
 *      be re-injected. A copy goes to docs/review.md for the user; that file is never the source.
 *   9. SPAWN TOPOLOGY - only the primary may spawn a role agent. A subagent may spawn a read-only
 *      scout and nothing else. Checked against EVERY agent in a (possibly batched) task call.
 *  10. NO SETTLING WITH WORK OPEN - if the primary tries to finish while the Final-acceptance
 *      checklist in docs/report.md still has unticked boxes, `session_stop` sends it back to work.
 *      Nags the MODEL, never the user: capped, and only in a session that actually changed files.
 *  17. MILESTONE TYPES MUST BE DECOMPOSED - large-feature / architecture-change / new-project cannot
 *      start the coder until docs/report.md carries a real milestone ledger. Size is measured from
 *      disk, not guessed: this is the mechanical half of "the task is big".
 *  16. THE LIVE HARNESS IS NOT EDITABLE FROM A SESSION - no agent rewrites keel.ts, its own agent
 *      file, RULES.md or config.yml. A guard the constrained party can delete is not a guard.
 *  15. SUBAGENTS CANNOT WRITE CONTROL FILES - contract / plan / report / review / decisions are the
 *      orchestrator's. A coder able to edit docs/plan.md could widen its own SCOPE; one able to edit
 *      docs/review.md could forge the verdict it is supposed to obey.
 *  14. TASK TYPE IS MECHANICAL - `Тип:` in docs/contract.md must resolve to a known type; it sets the
 *      rules injected into every spawn, the per-spawn `effort`, and (for `audit`) refuses the coder.
 *  13. READ-ONLY AGENTS CANNOT ACT - scout / designer / planner are blocked from any tool that is
 *      not recognisably a read. This is the only cover for MCP: an agent's `tools:` allowlist filters
 *      omp built-ins ONLY, so MCP tools reach every subagent regardless of what its file declares.
 *  12. ONE WRITER AT A TIME - a task call may not launch two coders, nor a coder beside the reviewer
 *      that judges it, nor a second coder while one is still in flight. Reads still fan out freely.
 *  11. NO LSP WRITES - the lsp tool's write actions (rename / rename_file / code_actions apply) edit
 *      files and would auto-approve under yolo; they are blocked outright. The coder writes through
 *      edit/write/ast_edit (checkpointed, scope-locked); read-only agents don't write at all. lsp
 *      READ actions (definition/references/hover/diagnostics/symbols) are untouched.
 *
 * FIRST RUN - on the first session after install, if config.yml still carries the setup marker,
 * KEEL pushes a one-time onboarding message into the chat asking the user to connect a provider
 * (`/login` inside the session, or a provider API-key env var) and set real model ids. It never
 * blocks work; it just makes the unfinished step impossible to miss. NOTE: there is no `omp login`
 * CLI command - the real paths are the in-session `/login`, `omp auth-broker login <provider>`, or
 * an env key such as OPENROUTER_API_KEY (credentials live in agent.db, not in config.yml).
 *
 * Everything fails OPEN: a bug here can never freeze a session.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

// omp mutating tools (verified against builtin-names.ts + tool approval tiers). No `delete`/`move`
// tool exists in omp; deletion happens through `bash rm` or a `write` of empty content, both of
// which are covered below (shell-write gate / code fence / scope lock).
const MUTATING = new Set(["edit", "write", "ast_edit"]);
// Shell-capable exec tools. bash and eval can both write to disk; they are gated by whether the
// COMMAND writes, not by the tool name.
const SHELL_TOOLS = new Set(["bash", "eval"]);

// The control files the orchestrator IS allowed to write - and nothing else. `decisions.md` is the
// engineering-decision log: without it the reasoning behind a choice only survives in memory, where
// the user cannot read it. PHASE_REPORT_<slug>.md is per-session subagent output.
const CONTROL_FILE =
  /(^|[/\\])docs[/\\](contract|plan|report|review|decisions|PHASE_REPORT[\w.-]*)\.md$/i;

const HOME_DIR = (process.env.HOME || process.env.USERPROFILE || "/~nohome").replace(/\\/g, "/").toLowerCase();

const pathOf = (i: any): string => String(i?.path ?? i?.file ?? i?.filename ?? "");

// A target named by a non-filesystem (MCP) tool: a scene actor, an asset, a remote object. Kept
// separate from pathOf so filesystem logic stays unchanged; used only to decide whether a tool call
// identifies SOMETHING that scope can be checked against.
const mcpTargetOf = (i: any): string =>
  String(i?.actor ?? i?.asset ?? i?.object ?? i?.target ?? i?.object_path ?? i?.assetPath ?? "");

// First-run onboarding marker. INSTALL leaves this literal token in config.yml; the moment the user
// fills real ids it is gone, and the onboarding stops firing. One marker, easy to grep, no false hits.
const SETUP_MARKER = "KEEL_SETUP_REQUIRED";

// ---------------------------------------------------------------------------------------------
// Primary vs subagent. hasUI === true is always the primary (a subagent runs headless). When there
// is no UI (print / RPC primary, or a subagent) we fall back to the session-file shape: a subagent's
// file is nested one level deeper than the primary's (task/structured-subagent.ts writes it under the
// parent's artifacts dir), so an extra path separator after the id means "subagent".
// ---------------------------------------------------------------------------------------------
function isPrimarySession(ctx: any): boolean {
  if (ctx?.hasUI === true) return true;
  try {
    const sf = String(ctx?.sessionManager?.getSessionFile?.() ?? "");
    const after = sf.split(/[/\\]sessions[/\\]/)[1];
    if (after !== undefined) return !/[/\\]/.test(after); // nested => subagent
  } catch {
    /* fall through */
  }
  return false; // no UI and no telltale path => treat as subagent (fail toward the stricter role)
}

// Non-destructive restore point: `git stash create` builds a commit object WITHOUT touching the
// working tree, the index, or the stash list. Parked on a ref so it survives and is easy to diff.
function captureCheckpoint(cwd: string): string | null {
  try {
    const git = (args: string[]) =>
      spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5000 });
    if (git(["rev-parse", "--is-inside-work-tree"]).stdout?.trim() !== "true") return null;
    const sha = git(["stash", "create"]).stdout?.trim();
    if (!sha) return "clean"; // nothing modified yet - HEAD itself is the restore point
    git(["update-ref", "refs/keel/checkpoint", sha]);
    return sha.slice(0, 8);
  } catch {
    return null;
  }
}

const MAX_PUSHBACKS = 2;
// After this many identical blocks in one session, stop nagging in text and escalate: a model that
// keeps hitting the same wall must ask the user, not spin (field failure F: block->replan->block x26).
const STUCK_LIMIT = 3;

// Guard 10 reads this file. If it doesn't exist, acceptance would be silently unenforced - so the
// moment real work starts (the coder is cleared to run) we make sure the checklist exists.
const ACCEPTANCE = [
  "# Report - current state",
  "",
  "## Task ledger",
  // NOT a `<placeholder>` row: openTasks() ignores angle-bracket rows, so a placeholder here left
  // taskIsActive() false and the SCOPE LOCK DISABLED for the whole start of implementation - the
  // coder could edit any pre-existing file outside scope. A real row arms the lock immediately; the
  // orchestrator renames it to the actual task.
  "- [ ] T1 active task - rename to the real task name - lane: standard - status: coding",
  "",
  "## Current task",
  "Milestone ledger: M1 [ ] * M2 [ ] * ...",
  "impl_round: 0/4",
  "Blockers: <none | stuck layer>",
  "",
  "## Final acceptance (Step 6) - tick only what is actually verified",
  "- [ ] Ledger closed - every task/milestone done with a passed gate",
  "- [ ] Every contract field has evidence from the orchestrator's INDEPENDENT live check",
  "- [ ] `remaining` empty (or the limitation is named to the user, with the reason)",
  "- [ ] Full regression pass at the end (whole suite + LSP, after all milestones)",
  "- [ ] No leftovers introduced by this work (stub / TODO / debug print / dead scaffold)",
  "- [ ] It runs - feature exercised end to end one final time",
  "",
].join("\n");

function seedReportIfMissing(cwd: string): void {
  try {
    readFileSync(join(cwd, "docs", "report.md"), "utf8");
  } catch {
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs", "report.md"), ACCEPTANCE, "utf8");
    } catch {
      /* fail open */
    }
  }
}

function readReport(cwd: string): string | null {
  for (const rel of ["docs/report.md", "report.md"]) {
    try {
      return readFileSync(join(cwd, rel), "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

// Agents that are meaningless without a contract. designer/scout do exploratory work and are exempt.
const CONTRACT_BOUND = new Set(["coder", "reviewer"]);

// ---------------------------------------------------------------------------------------------
// BATCH-AWARE agent detection. The omp `task` tool has two wire shapes (task/index.ts):
//   batch on  (DEFAULT): { context, tasks: [ { name?, agent?, task, ... } ] }
//   batch off:           { name?, agent?, task, ... }   (flat)
// The agent name lives INSIDE each item. Reading only the top level (the old bug) blinded the plan
// gate's sibling guards and the spawn topology on every default-config call. eachTaskItem yields
// each spawn item for both shapes; collectAgents returns the lowercased agent of every item.
// ---------------------------------------------------------------------------------------------
const AGENT_KEYS = ["agent", "agent_type", "subagent_type", "agentName", "role", "type"];

function agentOfItem(item: any): string {
  if (!item || typeof item !== "object") return "";
  for (const k of AGENT_KEYS) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  }
  return "";
}

function eachTaskItem(input: any): any[] {
  const i = input ?? {};
  if (Array.isArray(i.tasks) && i.tasks.length > 0) return i.tasks; // batch shape
  return [i]; // flat shape - the call itself is the single item
}

// Every agent this task call would spawn (lowercased). An item with no explicit agent resolves to
// the spawn-policy default later in omp; we return "" for it so callers can decide (the default for
// the primary is `task`, never a role agent, so "" must NOT be treated as coder/reviewer).
function collectAgents(input: any): string[] {
  return eachTaskItem(input).map(agentOfItem);
}

// Does this call spawn the named agent in ANY item?
function spawnsAgent(input: any, name: string): boolean {
  const n = name.toLowerCase();
  return collectAgents(input).some((a) => a === n);
}
const spawnsCoder = (input: any): boolean => spawnsAgent(input, "coder");

// ---------------------------------------------------------------------------------------------
// Scope enforcement is FAIL-CLOSED inside a harness project. We do not try to guess which tools
// mutate (an opaque MCP tool like `unreal_exec` would slip a verb list). Only clearly READ-ONLY
// tools and harness infrastructure are exempt; everything else must address something the plan
// declared. The read-only test is ANCHORED (a read verb at the START of the tool name or as a whole
// dotted/underscored segment boundary at the head) so a write tool cannot smuggle exemption by
// containing "get"/"list" somewhere in the middle (e.g. `list_and_exec`, `search_replace`).
// ---------------------------------------------------------------------------------------------
// read-only only if the WHOLE name is a read verb, optionally with a benign read suffix. A compound
// name whose second word is an action (get_shell, list_and_exec, search_replace, find_and_delete,
// describe_then_write) is NOT read-only - that was the exact exemption exploit.
const READ_ONLY_TOOL =
  /^(read|get|list|search|find|query|inspect|describe|show|status|diff|log|grep|glob|ls|cat|view|fetch|lookup|count|exists|help)(_(file|files|dir|dirs|directory|content|contents|status|info|meta|metadata|tree|all|many|one|by_id|range|lines|symbol|symbols|refs|references|definition|usages))?$/i;

// omp's OWN read tier (packages/coding-agent/src/task/read-only-policy.ts READ_ONLY_TOOL_NAMES).
// Mirrored verbatim: these can never damage the project, so the scope lock must not touch them.
// This is what previously mis-gated `ast_grep` - a pure search tool - as if it were a mutation.
const READ_ONLY_BUILTIN = new Set([
  "read", "grep", "glob", "web_search", "ast_grep", "yield", "hub", "ask", "todo",
  "recall", "reflect", "retain", "memory_edit", "inspect_image", "checkpoint", "rewind",
]);

// Harness plumbing that is not "work on the project" and must never be scope-blocked. Every name
// here is a REAL omp built-in (builtin-names.ts) - the previous list carried five that do not exist
// (`memory`, `plan`, `skill`, `todo_write`, `web_fetch`), which made this look authoritative while
// silently matching nothing. `github` was dropped on purpose: it can create branches and PRs, so it
// is project work and belongs under the scope lock. bash / eval are deliberately absent - a shell is
// a universal write tool, gated by whether the COMMAND writes (bashWrites), not exempted wholesale.
const INFRA_TOOL = new Set([
  "task", "lsp", "debug", "learn", "manage_skill", "security_scan", "goal", "think",
]);

/**
 * Agents that must never change ANYTHING, by any route. The `tools:` allowlist in an agent file only
 * filters omp BUILT-IN tools - MCP tools are attached separately (task/executor.ts creates the MCP
 * proxy set independently of `requestedTools`), so a "read-only" scout still receives every MCP tool
 * on the session, including ones that mutate a scene, an asset or a remote resource. omp's own
 * isReadOnlyAgent() only inspects declared built-ins, so it calls them read-only while that hole is
 * open. This closes it.
 *
 * `reviewer` is deliberately NOT here: it verifies UI through the browser MCP, which means
 * navigating and clicking. It stays covered by the scope lock, the lsp-write block and having no
 * edit/write/bash.
 */
const STRICT_READ_ONLY_AGENTS = new Set(["scout", "designer", "planner"]);

/**
 * Which agent is this session? The hook ctx exposes no agent identity, but it does expose
 * getSystemPrompt(), and a subagent's system prompt contains its own agent body
 * (structured-subagent.ts: planModeSubagentPrompt + agent.systemPrompt). Each agent file carries a
 * `KEEL-AGENT: <name>` marker, so the answer is read straight out of the prompt. Cached per session.
 */
function needsScope(tool: string): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  if (READ_ONLY_BUILTIN.has(t)) return false; // omp says it cannot write - believe it
  if (INFRA_TOOL.has(t)) return false;
  return !READ_ONLY_TOOL.test(t);
}

/** Anything we can positively recognise as harmless. Unknown names are NOT harmless. */
function looksReadOnly(tool: string): boolean {
  const t = (tool || "").toLowerCase();
  return READ_ONLY_BUILTIN.has(t) || INFRA_TOOL.has(t) || READ_ONLY_TOOL.test(t);
}

// The `lsp` tool is mostly read navigation (definition/references/hover/diagnostics - all in omp's
// LSP_READONLY_ACTIONS) so it sits in INFRA_TOOL above. But it ALSO exposes write actions that edit
// files: `rename` / `rename_file` (symbol/file rename) and `code_actions` with apply=true (applies a
// workspace edit). omp classifies those as "write" tier (lsp/tool.ts:157) - but under our
// approvalMode:yolo a write-tier lsp action auto-approves, and lspReadOnly is only auto-set in
// plan-mode (structured-subagent.ts:386), NOT for a normal reviewer/planner/coder spawn. So without
// this, a read-only agent could rename/edit through lsp, ungated. We treat an lsp write-action as a
// real mutation: it gets the checkpoint + scope-lock, and a read-only agent is blocked outright.
const LSP_WRITE_ACTIONS = new Set(["rename", "rename_file"]);
function isLspWrite(tool: string, input: any): boolean {
  if ((tool || "").toLowerCase() !== "lsp") return false;
  const action = String(input?.action ?? input?.op ?? input?.command ?? "").toLowerCase();
  if (LSP_WRITE_ACTIONS.has(action)) return true;
  // code_actions only writes when it applies the edit (apply=true / apply:"<id>").
  if (action === "code_actions" || action === "code_action") {
    const apply = input?.apply;
    return apply === true || (typeof apply === "string" && apply.trim().length > 0);
  }
  return false;
}

// Shell constructs that change something on disk. `npm test` / `pytest` / `git log` match none of
// these and stay free; a redirect or a destructive/copy verb pulls the command under the gate.
// Package managers ("npm install", "pip install") are NOT here - they touch dependency dirs, and
// blocking them breaks every real task; those dirs are also DISPOSABLE_PATH.
// Covers the previously-missed write vectors: cp, tee, install, ln, dd, and python/node/ruby/perl -c
// one-liners (a shell one-liner is a write tool too).
const SHELL_WRITE =
  /(^|[\s;&|(`])(rm|mv|cp|dd|tee|ln|truncate|shred|unlink|chmod|chown|touch|mkdir|rmdir)(\s|$)/i;
// bare `install` (coreutils) writes files; `npm/pip/cargo/... install` is a package op on deps, not
// user work, so it must stay free.
const BARE_INSTALL = /(^|[\s;&|(`])install\s/i;
const PKG_INSTALL =
  /\b(npm|pnpm|yarn|bun|pip|pip3|poetry|cargo|go|gem|apt|apt-get|brew|dnf|yum|pacman|nix|uv)\b[^\n]*\binstall\b/i;
/**
 * Quoted text is DATA, not syntax. Without stripping it first, `grep -- "-->" file.md`,
 * `echo "<!-- SCOPE -->"` and `git log --pretty=format:"%h>%s"` all read as redirections and got
 * treated as writes - a false block on ordinary commands. Quotes are replaced by spaces so offsets
 * and word boundaries survive.
 */
function stripQuoted(cmd: string): string {
  return cmd.replace(/'[^']*'|"[^"]*"/g, (m) => " ".repeat(m.length));
}

// `> file`, `>> file` and the clobber form `>| file`. Not `>&2` (fd duplication, writes nothing),
// and not the arrows `->`, `-->`, `=>`, which are text rather than redirection.
const SHELL_REDIRECT = /(^|[^-=&>])>>?\|?\s*[^&\s]/;
const SHELL_INPLACE =
  /\b(sed|perl)\s+-i\b|\bgit\s+(checkout|reset|clean|rm|apply|restore|stash)\b|\bpatch\b/i;
// omp resolves the shell from the `shellPath` setting: Git Bash on Windows, $SHELL on POSIX, with
// cmd.exe as the last-resort Windows fallback - and a user may point it at PowerShell. The POSIX
// verbs above would then be blind, so the same write intent is matched in PowerShell and cmd form.
// The harness must behave identically on Linux, macOS and Windows whatever shell is underneath.
const SHELL_WRITE_PS =
  /\b(Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item|Rename-Item|Clear-Content|Set-ItemProperty|Export-Csv|Tee-Object)\b/i;
const SHELL_WRITE_CMD = /(^|[\s&|(])(copy|xcopy|robocopy|move|ren|rename|del|erase|rmdir|rd|mklink)\s/i;
// An inline interpreter one-liner can open a file for writing. Conservative: only when the snippet
// actually references a write mode / write API, so a read-only `python -c 'print(1)'` stays free.
const SHELL_INLINE_WRITE =
  /\b(?:python[0-9.]*|node|ruby|perl|deno|bun)\b[^\n]*\b(?:open\s*\([^)]*['"][wa]\+?['"]|writeFile|writeFileSync|writeTextFile|appendFile|appendFileSync|appendTextFile|createWriteStream|copyFile|copyFileSync|rename|renameSync|rmSync|unlinkSync|mkdirSync|write_text|write_bytes|shutil\.(?:copy|move|rmtree))/i;

function commandOf(input: any): string {
  const i = input ?? {};
  // bash uses `command`; eval uses `code`/`source`/`command` depending on backend.
  return String(i.command ?? i.code ?? i.source ?? i.script ?? "");
}

function bashWrites(input: any): boolean {
  try {
    const cmd = commandOf(input);
    if (!cmd) return false;
    const writes =
      SHELL_WRITE.test(cmd) ||
      (BARE_INSTALL.test(cmd) && !PKG_INSTALL.test(cmd)) ||
      SHELL_REDIRECT.test(stripQuoted(cmd)) ||
      SHELL_INPLACE.test(cmd) ||
      SHELL_WRITE_PS.test(cmd) ||
      SHELL_WRITE_CMD.test(cmd) ||
      SHELL_INLINE_WRITE.test(cmd);
    if (!writes) return false;
    // A redirect whose ONLY target is a disposable path (a scratch file, a build dir) is not the
    // kind of write this guard exists for.
    // A redirect whose ONLY target is a disposable path (a scratch file, a build dir) or a device
    // (`2>/dev/null` on a test run) is not the kind of write this guard exists for.
    // Collect EVERY redirect destination, devices included (`2>/dev/null` has an fd digit before
    // the `>`, which an earlier version of this check did not allow for). If the command's only
    // writes go to devices or throwaway locations, it is not the kind of write this guard exists
    // for - and blocking `npm test 2>/dev/null` would be a daily false positive.
    const raw: string[] = [];
    for (const m of stripQuoted(cmd).matchAll(/(?:^|[^-=&>])\d?>>?\|?\s*([^\s'"|;&)<>]+)/g)) if (m[1]) raw.push(m[1]);
    const otherWrite =
      SHELL_WRITE.test(cmd) || SHELL_INPLACE.test(cmd) || SHELL_WRITE_PS.test(cmd) ||
      SHELL_WRITE_CMD.test(cmd) || SHELL_INLINE_WRITE.test(cmd) ||
      (BARE_INSTALL.test(cmd) && !PKG_INSTALL.test(cmd));
    const harmless = (x: string) => /^\/dev\//.test(x) || DISPOSABLE_PATH.test(x);
    if (!otherWrite && raw.length > 0 && raw.every(harmless)) return false;
    return true;
  } catch {
    return false;
  }
}

// A scope entry so broad it protects nothing. Rejecting these stops a lazy or over-cautious plan
// from handing back the freedom to touch everything.
const TOO_BROAD = new Set([".", "/", "*", "**", "./", "src", "app", "lib", "all", "project"]);
function usableScope(scope: string[]): string[] {
  return scope.filter(
    (e) =>
      e.length >= 3 &&
      e.length <= 400 && // см. entryMatchesTarget: длинные записи ломали построение регулярки
      !TOO_BROAD.has(e.toLowerCase().replace(/\/+$/, "")) &&
      // An unfilled placeholder is not a scope entry. The contract is already rejected when it
      // still holds `<...>` (unresolvedIn) and ledger rows with angle brackets are ignored
      // (openTasks); scope must be held to the same standard. Without this, a plan whose SCOPE was
      // never filled in counts as "usable": the coder gets spawned, the fail-closed no-scope guard
      // stays silent, and every later write is refused against a nonsense entry.
      !/<[^<>\n]*>/.test(e),
  );
}

// Does this path already exist? Only pre-existing things need scope protection (creating something
// new cannot destroy what already works). A directory (EISDIR) exists too; only ENOENT means "no".
function fileExists(p: string, cwd: string): boolean {
  if (!p) return false;
  // `~/x` is a real location; without expansion stat() fails, the target looks like a brand-new file
  // and the "creating something new cannot destroy anything" exemption waves it through.
  if (/^~(?=[/\\]|$)/.test(p)) p = p.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "~");
  for (const cand of [p, join(cwd, p)]) {
    try {
      readFileSync(cand, "utf8");
      return true;
    } catch (e: any) {
      if (e && e.code && e.code !== "ENOENT") return true;
    }
  }
  return false;
}

// A ledger row is a real task only when it has no unresolved placeholder. The shipped template
// carries "- [ ] T1 <task>", and reading that as an open task would make every fresh project look
// like work in progress.
function openTasks(cwd: string): number {
  const r = readReport(cwd);
  if (!r) return 0;
  const rows = r.match(/^-\s*\[ \]\s*T\S*.*$/gm) ?? [];
  // ANY <...> in a ledger row is a placeholder - real task names do not contain angle brackets.
  return rows.filter((l) => !/<[^<>\n]*>/.test(l)).length;
}

// SCOPE only has force while a task is actually open. A plan left over from a finished task must
// not govern a new session - that is what paralysed a fresh session in the field (failure B).
function taskIsActive(cwd: string): boolean {
  return openTasks(cwd) > 0;
}

// The phase detector must not be able to blind itself: when a task is declared (a plan with a
// usable SCOPE is written) and no ledger row is open, open one.
function ensureLedgerRow(cwd: string): void {
  try {
    if (openTasks(cwd) > 0) return;
    const r = readReport(cwd);
    if (!r) return;
    const stamped = r.replace(
      /^(##\s*Task ledger.*)$/m,
      "$1\n- [ ] T" + (Date.now() % 1000) + " active task (opened by KEEL when the plan was written)",
    );
    if (stamped !== r) writeFileSync(join(cwd, "docs", "report.md"), stamped, "utf8");
  } catch {
    /* fail open */
  }
}

function isHarnessProject(cwd: string): boolean {
  for (const rel of [["docs", "plan.md"], ["docs", "contract.md"], ["docs", "report.md"]]) {
    try {
      readFileSync(join(cwd, ...rel), "utf8");
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function readScope(cwd: string): string[] {
  try {
    const t = readFileSync(join(cwd, "docs", "plan.md"), "utf8");
    const m = t.match(/<!--\s*SCOPE\s*-->([\s\S]*?)<!--\s*END SCOPE\s*-->/i);
    if (!m) return [];
    return m[1]
      .split("\n")
      .map((l) => l.replace(/^[-*\s]+/, "").trim())
      .filter((l) => l.length > 1 && !l.startsWith("#"));
  } catch {
    return [];
  }
}

// The harness's own control files (docs/) are ALWAYS writable. Without this, fail-closed becomes a
// deadlock: with no scope you cannot write the plan, and the plan is where scope is declared.
const CONTROL_PATH = /(^|[/\\])docs[/\\]/;

// The harness's OWN directory is not project work, so the SCOPE lock does not apply there. The CODE
// FENCE still does: keel.ts is code, so the coder edits it, not the orchestrator.
const HARNESS_PATH = /[/\\]\.omp[/\\]|[/\\]\.pi[/\\]/;

// Generated, installed or throwaway locations. Nobody's work lives here, so guarding them only
// produces false blocks on builds, installs and scratch files.
const DISPOSABLE_PATH =
  /(^|[/\\])(node_modules|dist|build|out|target|coverage|\.next|\.nuxt|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|\.cache|\.turbo|\.gradle|bin|obj)[/\\]|^\/tmp[/\\]|^\/var\/folders[/\\]/;

// ---------------------------------------------------------------------------------------------
// Does this call address something the plan named? Positive matching against the SPECIFIC target of
// the call, not a blind substring over the whole serialized input (the old bug let a scope string
// mentioned in a comment authorize a destructive command, and blocked a legitimate edit whose path
// was not mentioned verbatim). We match each scope entry against the call's real target(s): the file
// path(s), and for a shell command the tokens that look like paths/targets - on a path-segment
// boundary so `House_B` does not match `House_Battery`.
// ---------------------------------------------------------------------------------------------
/**
 * Where does this shell command actually WRITE? targetsScope() is a `some()` over every path-like
 * token, which suits a tool call naming one target but not a command line: merely READING an
 * in-scope file was enough to legalise a write anywhere, e.g.
 *   echo $(cat src/in-scope.ts) > secret.ts
 * So a shell write is judged by its destination. Returns [] when the destination cannot be
 * identified, and the caller then falls back to the token scan.
 */
function shellWriteTargets(cmd: string): string[] {
  if (!cmd) return [];
  const out: string[] = [];
  // `>|` - clobber-форма, тоже перенаправление. /dev/null и прочие устройства целью не считаем:
  // `npm test 2>/dev/null` - обычная команда, и блокировать её было бы ложным срабатыванием.
  const bare = stripQuoted(cmd);
  for (const m of bare.matchAll(/(?:^|[^-=&>])>>?\|?\s*([^\s'"|;&)<>]+)/g)) {
    const dest = m[1];
    if (dest && !/^\/dev\//.test(dest)) out.push(dest);
  }
  // cp / mv / install / ln / rsync write to their LAST argument.
  const copy = cmd.match(/(?:^|[\s;&|(`])(?:cp|mv|install|ln|rsync)\s+(.+)$/i);
  if (copy) {
    const args = copy[1].split(/\s+/).filter((a) => a && !a.startsWith("-") && !/[<>|;&]/.test(a));
    if (args.length >= 2) out.push(args[args.length - 1].replace(/["']/g, ""));
  }
  return out;
}

function targetsOf(input: any): string[] {
  const out: string[] = [];
  const p = pathOf(input);
  if (p) out.push(p);
  const i = input ?? {};
  // MCP identifier fields too: without these a scene actor / asset named via `actor:` or `asset:`
  // produced ZERO targets, and targetsScope() treats "no targets" as "nothing to check" -> allowed.
  for (const k of ["path", "file", "filename", "paths", "files", "actor", "asset", "object", "target", "object_path", "assetPath"]) {
    const v = i[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) for (const e of v) if (typeof e === "string") out.push(e.trim());
  }
  const cmd = commandOf(input);
  if (cmd) {
    // path-like tokens: anything with a slash, or a bare filename with an extension, plus explicit
    // MCP/actor identifiers (word.word or Word_Word) so scene actors / assets are matchable.
    for (const m of cmd.matchAll(/[^\s'"();|&]+/g)) {
      const tok = m[0];
      if (/[/\\]/.test(tok) || /\.[A-Za-z0-9]+$/.test(tok) || /^[A-Za-z][\w.-]{2,}$/.test(tok)) {
        out.push(tok);
      }
    }
  }
  return out;
}

// Match one scope entry against one target on a boundary: exact, path-prefix (scope is a dir/file
// the target lives under or equals), or identifier match delimited by a non-word char. Substring in
// the middle of a longer identifier does NOT match.
function entryMatchesTarget(entry: string, target: string): boolean {
  // Separators are normalised on BOTH sides: a plan written on Windows (`src\win.ts`) must match a
  // call made with POSIX separators (`src/win.ts`), and vice versa.
  // Collapse `.` and `..` BEFORE comparing. Without this, `src/ok.ts/../../secret.ts` starts with an
  // in-scope entry and sailed straight through `t.startsWith(e + "/")` - a real escape from any
  // scoped path to anywhere in the tree. Also expand a leading `~`, which fileExists cannot stat and
  // which therefore looked like a harmless new file.
  const collapse = (x: string): string => {
    const abs = x.startsWith("/");
    const out: string[] = [];
    for (const seg of x.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (out.length === 0) out.push("..");     // keep, so it can never match an entry
        else if (out[out.length - 1] === "..") out.push("..");
        else out.pop();
        continue;
      }
      out.push(seg);
    }
    return (abs ? "/" : "") + out.join("/");
  };
  const norm = (x: string) =>
    collapse(
      x.toLowerCase().replace(/\\/g, "/").replace(/^[.]\//, "").replace(/^~(?=\/|$)/, HOME_DIR),
    );
  const e = norm(entry).replace(/\/+$/, "");
  const t = norm(target);
  if (!e) return false;
  if (t === e) return true;
  if (t.startsWith(e + "/")) return true; // target under a scoped dir/file
  if (e.startsWith(t + "/")) return true; // scoped path under the target dir
  // identifier / actor / asset name: boundary match, not mid-token substring.
  // A scope entry is a path or an actor name, never prose. Anything longer is either a mistake or an
  // attack: `new RegExp` throws "Regular expression too large" past ~30k characters, the exception
  // escapes into the handler's fail-open catch, and the SCOPE LOCK SILENTLY STOPS WORKING for the
  // rest of the session. One long line in docs/plan.md was enough. Bounded, it simply cannot happen.
  if (e.length > 200) return false;
  // MUST test the NORMALISED target: testing the raw string re-opened the traversal this function
  // just closed - `src/ok.ts/../../secret.ts` still literally contains `src/ok.ts`.
  const re = new RegExp("(^|[^A-Za-z0-9_])" + e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Za-z0-9_]|$)", "i");
  return re.test(t);
}

function targetsScope(input: any, scope: string[]): boolean {
  const targets = targetsOf(input);
  if (targets.length === 0) return true; // nothing target-like to inspect -> do not block
  return targets.some((t) => scope.some((e) => entryMatchesTarget(e, t)));
}

function readContract(cwd: string): string | null {
  try {
    const t = readFileSync(join(cwd, "docs", "contract.md"), "utf8");
    return t.trim().length > 0 ? t : null;
  } catch {
    return null;
  }
}

// Planning must not begin while variables are open, so a contract that still carries template
// placeholders means the unknowns were never closed. Conservative: multi-word angle placeholders
// (<where the control goes>) plus explicit TBD markers. A real sentence like "response < 200ms" has
// no closing bracket, so it won't trip this.
const PLACEHOLDER = /<[^<>\n]*\s[^<>\n]*>|\bTBD\b|\?\?\?/;
function unresolvedIn(contract: string): boolean {
  return PLACEHOLDER.test(contract);
}

// Pull the reviewer's next_prompt out of a (blocking) task result. `tool_result` may carry
// structured `details` as well as `content`; try both, then fall back to the raw text. Returns null
// when nothing usable was found - the caller must treat that as a capture FAILURE, not "no findings".
function extractNextPrompt(event: any): string | null {
  const fromObj = (o: any): string | null => {
    if (!o || typeof o !== "object") return null;
    // The reviewer's schema fields live under structuredOutput.data (executor.ts:706:
    // { source, mode, status, data: completeData }). Check the object itself AND its .data, so this
    // works whether we're handed the raw structuredOutput, its .data, or a plain result object.
    const pick = (x: any): string | null => {
      if (!x || typeof x !== "object") return null;
      const v = x.next_prompt ?? x.nextPrompt ?? x.instruction;
      return typeof v === "string" && v.trim().length > 0 ? v : null;
    };
    return pick(o) ?? pick(o.data);
  };
  // details.results[] is the sync/batch shape (task/index.ts mergeSyncPayloads -> details.results).
  const scanResults = (d: any): string | null => {
    const rs = d?.results;
    if (Array.isArray(rs)) {
      for (const r of rs) {
        const hit = fromObj(r?.structuredOutput) ?? fromObj(r);
        if (hit) return hit;
      }
    }
    return null;
  };
  const direct =
    fromObj(event?.details) ??
    scanResults(event?.details) ??
    fromObj(event?.result) ??
    fromObj(event?.output);
  if (direct) return direct;
  const raw = textOf(event?.content);
  if (!raw) return null;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = fromObj(JSON.parse(m[0]));
      if (parsed) return parsed;
    }
  } catch {
    /* not JSON */
  }
  return /next_prompt/i.test(raw) ? raw : null;
}

// The phase is derived from what is on disk right now, so it cannot go stale and the model cannot
// misreport it. Returns the line to inject, plus a short label for the status bar.
/**
 * docs/report.md carries TWO kinds of `- [ ]` boxes: task-ledger rows (`- [ ] T1 ... `) and the
 * Final-acceptance checklist. Counting them together was a real bug: the ledger row is itself an
 * unchecked box, so "acceptance closed while a task is still open" could never be true, the
 * acceptance count was inflated by the ledger, and the closing phase was unreachable. Ledger rows
 * are identified exactly as openTasks() identifies them, so the two never disagree.
 */
/**
 * A seeded-but-unnamed ledger row (`- [ ] T1 <task> ...`). openTasks() deliberately ignores rows
 * with angle brackets, so right after the plan gate seeds docs/report.md the ledger has zero OPEN
 * tasks while the work is in fact just starting. Without this distinction the leftovers branch fired
 * and told the orchestrator to replace the contract and plan it had literally just had approved.
 */
function ledgerPlaceholders(cwd: string): number {
  const r = readReport(cwd);
  if (!r) return 0;
  const rows = r.match(/^-\s*\[ \]\s*T\S*.*$/gm) ?? [];
  return rows.filter((l) => /<[^<>\n]*>/.test(l)).length;
}

function acceptanceBoxes(cwd: string): { total: number; open: number } {
  const r = readReport(cwd);
  if (!r) return { total: 0, open: 0 };
  const isLedger = (line: string) => /^-\s*\[[ xX]\]\s*T\S*/.test(line);
  const lines = r.split("\n");
  let total = 0;
  let open = 0;
  for (const line of lines) {
    if (!/^-\s*\[[ xX]\]/.test(line) || isLedger(line)) continue;
    total++;
    if (/^-\s*\[ \]/.test(line)) open++;
  }
  return { total, open };
}

/**
 * Did the reviewer already gate the CURRENT plan? The in-memory flag only knows about this process,
 * so after a compaction/restart mid-task the phase used to regress to "проверка плана" and tell the
 * orchestrator to re-run a gate it had already passed. docs/review.md is written whenever a verdict
 * is captured, so "review.md is at least as new as plan.md" is a durable, disk-derived answer that
 * also invalidates itself automatically the moment a new plan is written.
 */
function planFingerprint(cwd: string): string | null {
  try {
    const t = readFileSync(join(cwd, "docs", "plan.md"), "utf8");
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + "-" + t.length;
  } catch {
    return null;
  }
}

const PLAN_STAMP = /<!--\s*KEEL-PLAN:\s*([\w-]+)\s*-->/;

function reviewerGatedCurrentPlan(cwd: string, inMemory: boolean): boolean {
  if (inMemory) return true;
  try {
    const review = readFileSync(join(cwd, "docs", "review.md"), "utf8");
    const stamped = review.match(PLAN_STAMP)?.[1];
    const current = planFingerprint(cwd);
    // Content fingerprint, NOT mtime: plan.md and review.md are written milliseconds apart and can
    // land on the SAME filesystem timestamp (and FAT/exFAT resolution is 2s), which made a fresh
    // plan look already-gated and silently skipped the gate phase.
    if (stamped && current) return stamped === current;
    // Legacy review.md with no stamp: fall back to a STRICT mtime comparison, so an equal timestamp
    // means "not gated" and we ask for a gate that may be redundant rather than skipping a real one.
    return statSync(join(cwd, "docs", "review.md")).mtimeMs > statSync(join(cwd, "docs", "plan.md")).mtimeMs;
  } catch {
    return false; // no review.md (or no plan) - the gate has not run
  }
}

/**
 * Does the contract describe a REAL frontend surface? The template ships a `## Frontend` heading
 * with `<placeholder>` bullets, so the heading alone proves nothing - a back-end-only task keeps
 * the section but never fills it. Only count lines under the heading that carry real content.
 */
/**
 * TASK TYPES. Ported from the user's Claude Code command set (/bug-fix, /refactor, /audit, ...).
 * There the type lived in which slash command you typed - it could be forgotten, and nothing
 * enforced it. Here it lives as `Тип:` in docs/contract.md, so it survives compaction and restart,
 * shows in the status bar, and changes MECHANICS rather than wording:
 *   gates  - how many approvals the harness takes before code starts
 *   effort - the per-spawn thinking budget (omp `effort`, needs task.enableEffort)
 *   rules  - injected verbatim into every contract-bound spawn
 *   noCoder- audit is read-only: the coder is refused outright
 */
type TaskType = {
  label: string;
  gates: number;
  effort: "lo" | "med" | "hi";
  noCoder?: boolean;
  rules: string;
};

const TASK_TYPES: Record<string, TaskType> = {
  "bug-fix": {
    label: "bug-fix", gates: 1, effort: "hi",
    rules:
      "ТИП: BUG-FIX. Отдели симптом от корневой причины и назови причину до того, как предложишь " +
      "правку. Причину устанавливай ОТЛАДЧИКОМ (тул `debug`: точки останова, стек, значения " +
      "переменных в момент отказа), а не рассуждением - в отчёте должен быть вывод отладчика или " +
      "воспроизведение, а не догадка. Правка - наименьшая безопасная. Ничего попутно не улучшай.",
  },
  "small-feature": {
    label: "small-feature", gates: 1, effort: "med",
    rules:
      "ТИП: SMALL-FEATURE. Расширяй существующее вместо создания нового. Реализуй наименьший " +
      "безопасный вариант. Запрошенный объём не расширяй; смежные улучшения не вноси.",
  },
  "large-feature": {
    label: "large-feature", gates: 3, effort: "hi",
    rules:
      "ТИП: LARGE-FEATURE. Работа идёт милями: одна миля за раз, каждая проверяется до перехода к " +
      "следующей. Зависимости между милями должны быть явными. После каждой мили - сквозная " +
      "проверка импортов: для каждого нового символа найди все файлы, которые его используют, и " +
      "убедись, что импорт на месте.",
  },
  refactor: {
    label: "refactor", gates: 1, effort: "hi",
    rules:
      "ТИП: REFACTOR. Поведение обязано остаться идентичным. Прогони проверки ДО и ПОСЛЕ и покажи " +
      "оба результата - это и есть доказательство. Новой функциональности не добавляй, даже " +
      "родственной. Удаление предпочтительнее добавления.",
  },
  "architecture-change": {
    label: "architecture-change", gates: 3, effort: "hi",
    rules:
      "ТИП: ARCHITECTURE-CHANGE. Сначала обоснуй само изменение - оправдано ли оно. Определи " +
      "затронутые модули, зависимости и путь миграции. Для критичных стадий назови ТОЧКИ ОТКАТА. " +
      "Совместимость системы должна сохраняться между стадиями, а не только в конце.",
  },
  "new-project": {
    label: "new-project", gates: 3, effort: "med",
    rules:
      "ТИП: NEW-PROJECT. Первая миля - MVP: она должна дать работающее ядро. Дели работу на " +
      "наименьшие самостоятельно проверяемые мили. Преждевременных абстракций не вводи.",
  },
  audit: {
    label: "audit", gates: 1, effort: "hi", noCoder: true,
    rules:
      "ТИП: AUDIT. Это ТОЛЬКО ЧТЕНИЕ - код не меняется, кодер не запускается (харнесс его не " +
      "пустит). Зоны аудита перечисли явно и не расширяй по ходу. Раздай непересекающиеся зоны " +
      "скаутам, сырые находки каждый пишет в свой docs/PHASE_REPORT_audit-<зона>.md. Покрытие " +
      "проверяется ЧИСЛОМ: (сырых находок) = (попавших в отчёт) + (отклонённых с причиной). " +
      "Проверка «в разделе есть хотя бы одна находка» покрытием не считается.",
  },
  adopt: {
    label: "adopt", gates: 1, effort: "med",
    rules:
      "ТИП: ADOPT. Проект уже существует: определи язык, точки входа и структуру по файловой " +
      "системе, а не по догадкам. Заведи docs/ с контрактом, планом и отчётом. Ничего не " +
      "переписывай - только опиши то, что есть, и назови, что требует ручного заполнения.",
  },
};

/** `Тип:` из docs/contract.md. Незаполненная заглушка типом не считается. */
function taskTypeOf(cwd: string): TaskType | null {
  try {
    const c = readContract(cwd);
    if (!c) return null;
    // Strip a trailing `#`/`//` comment: `Тип: refactor   # почему так` is a natural thing to write
    // and used to fall through as an unrecognised type.
    const raw = c
      .match(/^\s*(?:Тип|Type)\s*:\s*(.+)$/im)?.[1]
      ?.replace(/\s+(#|\/\/).*$/, "")
      .trim()
      .toLowerCase();
    if (!raw || /[<>|]/.test(raw)) return null; // шаблонная заглушка
    return TASK_TYPES[raw] ?? null;
  } catch {
    return null;
  }
}

/**
 * Does this target leave the project? The "creating something new cannot destroy anything"
 * exemption is true INSIDE the repository - a new file there is just work. Outside it is not:
 * `../../../etc/cron.d/evil` does not exist either, and creating it is exactly the thing no scope
 * lock should wave through. So the exemption stops at the project boundary.
 */
function escapesProject(target: string, cwd: string): boolean {
  if (!target) return false;
  const t = target.replace(/\\/g, "/").replace(/^~(?=\/|$)/, process.env.HOME || process.env.USERPROFILE || "~");
  const collapse = (x: string) => {
    const abs = x.startsWith("/");
    const out: string[] = [];
    for (const seg of x.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (out.length === 0 || out[out.length - 1] === "..") out.push("..");
        else out.pop();
        continue;
      }
      out.push(seg);
    }
    return (abs ? "/" : "") + out.join("/");
  };
  const c = collapse(cwd.replace(/\\/g, "/"));
  const full = t.startsWith("/") ? collapse(t) : collapse(c + "/" + t);
  return !(full === c || full.startsWith(c + "/"));
}

/** Заполненный ли реестр милей в docs/report.md (а не строка-заглушка из шаблона). */
function milestoneCount(cwd: string): number {
  const r = readReport(cwd);
  if (!r) return 0;
  const line = r.match(/^\s*Milestone ledger:.*$/im)?.[0] ?? "";
  if (/\.\.\./.test(line)) return 0; // шаблон не тронут
  return (line.match(/\bM\d+\s*\[/g) ?? []).length;
}

/** Типы, которые по определению идут милями. */
const MILESTONE_TYPES = new Set(["large-feature", "architecture-change", "new-project"]);

function contractHasFrontend(contract: string): boolean {
  try {
    const m = contract.match(/^##\s*Frontend\s*$([\s\S]*?)(?=^##\s|\Z)/im);
    if (!m) return false;
    return m[1]
      .split("\n")
      .map((l) => l.replace(/^[-*\s]+/, "").trim())
      .some((l) => l.length > 2 && !/^<[^<>]*>$/.test(l) && !/<[^<>\n]*>/.test(l));
  } catch {
    return false;
  }
}

function phaseOf(cwd: string, reviewerRanMemory: boolean): { label: string; say: string } {
  const reviewerRan = reviewerGatedCurrentPlan(cwd, reviewerRanMemory);
  // NOT a harness project (no docs/plan.md, contract.md or report.md): the scope-lock, the code
  // fence and the spawn gates all stand down here, so saying "ПРИЁМ" would be a lie - nothing is
  // being gated and no contract is expected. Say plainly that this is the free zone, and inject
  // nothing into the model's context (there is no pipeline obligation to remind it of).
  if (!isHarnessProject(cwd)) {
    return { label: "свободный режим", say: "" };
  }

  const contract = readContract(cwd);
  const contractReady = !!contract && !unresolvedIn(contract);
  const scope = usableScope(readScope(cwd));
  const open = openTasks(cwd);
  const acceptanceOpen = acceptanceBoxes(cwd).open;

  // The ledger was seeded but the task was never named. This is the START of work, not leftovers -
  // saying "replace the contract and plan" here would throw away the plan the user just approved.
  if (open === 0 && ledgerPlaceholders(cwd) > 0) {
    return {
      label: "4/4 · впиши название задачи в реестр",
      say:
        "[KEEL] В docs/report.md строка реестра осталась заглушкой (`T1 <...>`). Впиши настоящее " +
        "название задачи, полосу и статус - пока там угловые скобки, задача не считается открытой, " +
        "и приёмка не отслеживается. Контракт и план менять НЕ нужно: они действующие.",
    };
  }

  // Leftovers from a finished task: say so plainly instead of working to a dead plan.
  if (open === 0 && (contractReady || scope.length > 0)) {
    return {
      label: "документы от прошлой задачи",
      say:
        "[KEEL] Контракт и план остались от прошлой задачи, открытых задач нет. Начинаешь новую - " +
        "замени контракт и план, старые не действуют. Полосу объяви пользователю до начала работы.\n" +
        "Если контекст этой сессии уже длинный, предложи пользователю `/clear` перед новой задачей: " +
        "состояние живёт в docs/, и харнесс восстановит фазу сам - терять нечего.",
    };
  }

  if (!contract) {
    return {
      label: "1/4 · собираем задачу",
      say:
        "[KEEL] Фаза: ПРИЁМ. Объяви пользователю полосу (trivial/standard/large). Закрой неизвестные: " +
        "намерение - спроси его, факты о коде - скаутом. Затем запиши docs/contract.md " +
        "(фронт/бэк/связка/критерий успеха). Кодера не спавни и продуктовых файлов не пиши - из " +
        "из файлов тебе можно только управляющие в docs/ (contract, plan, report, review, decisions, PHASE_REPORT_<слаг>).",
    };
  }
  if (!contractReady) {
    return {
      label: "1/4 · в контракте пустые места",
      say:
        "[KEEL] Фаза: ПРИЁМ. В docs/contract.md остались незакрытые места (<...> / TBD). Пока они " +
        "там, кодер и ревьюер не запустятся - это блокируется. Закрой их с пользователем и впиши " +
        "реальные значения; не угадывай за него.",
    };
  }
  if (scope.length === 0) {
    return {
      label: "2/4 · планирование",
      say:
        "[KEEL] Фаза: ПЛАН. Контракт готов. Отдай планировщику; его ответ (план + блок SCOPE) запиши " +
        "в docs/plan.md как есть. Сам не планируй, scope не придумывай и артефактов не пиши - список " +
        "того, что задача вправе трогать, определяет ПЛАНИРОВЩИК, не ты.",
    };
  }
  if (!reviewerRan) {
    return {
      label: "3/4 · проверка плана",
      say:
        "[KEEL] Фаза: ГЕЙТ. Спавни reviewer на план+контракт. Его next_prompt дойдёт до кодера через " +
        "расширение дословно - не пересказывай его сам.",
    };
  }
  if (acceptanceOpen > 0) {
    return {
      label: "4/4 · работа и приёмка · открыто " + acceptanceOpen,
      say:
        "[KEEL] Фаза: ВЕРИФИКАЦИЯ. Прогони критерий успеха из контракта САМ на живой системе - " +
        "зелёные тесты кодера приёмкой не считаются. Потом закрой чек-лист в docs/report.md и " +
        "коммить. Частичную работу не сдавай.",
    };
  }
  // Acceptance checklist is fully ticked but the ledger still carries an open task. Previously this
  // returned null - the orchestrator got NO guidance here, so "what do I do to close it?" was
  // answered by guesswork. Say exactly what closing means.
  return {
    label: "4/4 · приёмка закрыта — закрой задачу",
    say:
      "[KEEL] Фаза: ЗАКРЫТИЕ. Чек-лист приёмки в docs/report.md закрыт, но строка задачи в реестре " +
      "ещё открыта. Чтобы закрыть задачу: (1) убедись, что критерий успеха из контракта прогнан " +
      "ТОБОЙ на живой системе, а не только тестами кодера; (2) закоммить изменения; (3) отметь " +
      "строку задачи в реестре docs/report.md как выполненную (- [x]). Новую задачу не начинай, " +
      "пока эта не закрыта.\n" +
      "Когда закроешь: всё состояние лежит в docs/ и переживает перезапуск, поэтому предложи " +
      "пользователю начать следующую задачу в ЧИСТОЙ сессии (`/clear` - очищает контекст, оставляя " +
      "сессию; `/handoff` - если нужен документ передачи). Контекст этой задачи дальше только мешает.",
  };
}

// ---------------------------------------------------------------------------------------------
// STATUS LINE. omp stores hook status per key, sorts keys by name and joins them, then truncates to
// the terminal width (docs/hooks.md "Status line behavior"). So the bar is built from named
// segments: keel-1 phase, keel-2 alert, keel-3 running agents, keel-4 git. An empty string clears a
// segment. Left-most survives truncation, so the phase goes first and git last.
// ---------------------------------------------------------------------------------------------

/** Relative age in Russian, from a unix timestamp in seconds. */
function agoRu(unixSec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSec));
  if (s < 60) return "только что";
  if (s < 3600) return Math.floor(s / 60) + "м назад";
  if (s < 86400) return Math.floor(s / 3600) + "ч назад";
  return Math.floor(s / 86400) + "д назад";
}

/** Russian plural agreement: 1 файл / 2 файла / 5 файлов. */
function filesRu(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return n + " файлов";
  if (mod10 === 1) return n + " файл";
  if (mod10 >= 2 && mod10 <= 4) return n + " файла";
  return n + " файлов";
}

type GitInfo = { repo: boolean; lastCommit: number | null; dirty: number };
let gitCache: { at: number; cwd: string; info: GitInfo } | null = null;

/** Cheap git snapshot, cached ~20s so the per-turn refresh never hammers a big repo. */
function invalidateGitCache(): void {
  gitCache = null;
}

function gitInfo(cwd: string): GitInfo {
  const now = Date.now();
  if (gitCache && gitCache.cwd === cwd && now - gitCache.at < 5000) return gitCache.info;
  const info: GitInfo = { repo: false, lastCommit: null, dirty: 0 };
  try {
    const git = (args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 3000 });
    if (git(["rev-parse", "--is-inside-work-tree"]).stdout?.trim() !== "true") {
      gitCache = { at: now, cwd, info };
      return info;
    }
    info.repo = true;
    const ts = git(["log", "-1", "--format=%ct"]).stdout?.trim(); // empty on a repo with no commits
    info.lastCommit = ts && /^\d+$/.test(ts) ? Number(ts) : null;
    const st = git(["status", "--porcelain"]).stdout ?? "";
    info.dirty = st.split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    /* git missing or slow - segment simply stays empty */
  }
  gitCache = { at: now, cwd, info };
  return info;
}

/**
 * The git segment. Normally informational; it turns into a warning exactly when the harness itself
 * says the work is done (acceptance checklist present and fully ticked) while changes are still
 * uncommitted - i.e. "declared finished but not saved", which is the moment work actually gets lost.
 */
function gitSegment(cwd: string): string {
  const g = gitInfo(cwd);
  if (!g.repo) return "";
  const acc = acceptanceBoxes(cwd);
  const acceptanceDone = acc.total > 0 && acc.open === 0;

  if (g.lastCommit === null) {
    return g.dirty > 0 ? "⚠ коммитов ещё нет · " + filesRu(g.dirty) : "";
  }
  const when = agoRu(g.lastCommit);
  if (g.dirty === 0) return "✓ коммит " + when;
  if (acceptanceDone) {
    return "⚠ приёмка закрыта, но " + filesRu(g.dirty) + " не сохранено — закоммить";
  }
  return "● " + filesRu(g.dirty) + " не сохранено · коммит " + when;
}

/** Repaint phase + git. Called on session_start and on every turn, so the bar is never stale. */
function paintStatus(ctx: any, cwd: string, reviewerRan: boolean): void {
  try {
    // Only the primary has a status bar. Subagents used to get one painted at session_start that
    // then never updated (the context hook is primary-only), which was dead weight and misleading
    // to anyone reading a subagent transcript.
    if (ctx?.hasUI !== true) return;
    const ph = phaseOf(cwd, reviewerRan);
    const tt = taskTypeOf(cwd);
    // Размер измерим: число записей SCOPE. Если он большой, а тип мелкий - это почти всегда
    // ошибка типа, и человек должен её увидеть. Не блокируем: судить о размере по числу файлов
    // можно только приблизительно, а вот показать рассогласование - честно и дёшево.
    const scopeSize = usableScope(readScope(cwd)).length;
    const mismatch =
      tt && !MILESTONE_TYPES.has(tt.label) && tt.label !== "audit" && scopeSize >= 6
        ? " ⚠ " + scopeSize + " файлов при типе " + tt.label
        : "";
    ctx?.ui?.setStatus?.("keel-1", "KEEL " + (tt ? tt.label + " · " : "") + ph.label + mismatch);
    ctx?.ui?.setStatus?.("keel-4", gitSegment(cwd));
  } catch {
    /* status is decoration - never let it break a turn */
  }
}

function textOf(content: any): string {
  try {
    return (content ?? [])
      .map((c: any) => (c?.type === "text" ? String(c.text ?? "") : ""))
      .join("")
      .trim();
  } catch {
    return "";
  }
}

// First-run detection: config.yml still carries the setup marker => onboarding not done.
function setupPending(_cwd: string): boolean {
  // config lives in the omp agent dir, not the project cwd; read from HOME/.omp/agent.
  const home = process.env.OMP_AGENT_DIR || join(process.env.HOME || process.env.USERPROFILE || ".", ".omp", "agent");
  try {
    return readFileSync(join(home, "config.yml"), "utf8").includes(SETUP_MARKER);
  } catch {
    return false; // can't read config -> don't nag
  }
}

// The one-time onboarding pushed into the chat on first run. Speaks to the user in Russian.
const FIRST_RUN_MESSAGE =
  "[KEEL] Первый запуск после установки. Прежде чем работать, нужно один раз настроить харнесс:\n\n" +
  "1. Подключи провайдера моделей - любым из двух способов: набери `/login` прямо здесь, в сессии " +
  "(омп покажет список провайдеров), либо задай ключ в окружении, например " +
  "`export OPENROUTER_API_KEY=...`. Ключи хранятся отдельно от config.yml и при обновлении " +
  "харнесса не теряются.\n" +
  "2. Открой `~/.omp/agent/config.yml` и в блоке `modelRoles` впиши реальные id моделей вместо " +
  "заглушек (они помечены `" + SETUP_MARKER + "`). Точные слаги смотри в `/models` внутри omp.\n" +
  "   - default: оркестратор (быстрая модель), plan/slow: планировщик и ревьюер (сильная модель),\n" +
  "     vision: модель с приёмом картинок, designer: UI-модель, smol/tiny: дешёвые фоновые.\n" +
  "3. Впиши модель кодера в `~/.omp/agent/agents/coder.md` (поле `model:`) - строгая схема (не DeepSeek).\n" +
  "4. Прогони `./verify.sh` (или `verify.ps1`) - должно быть 0 failed, и маркер `" + SETUP_MARKER + "` " +
  "должен исчезнуть.\n\n" +
  "Пока маркер в config.yml на месте, это сообщение будет появляться при старте. Когда всё заполнишь - " +
  "оно пропадёт само. Работать можно и сейчас, но модели-заглушки работать не будут.";

// Inject a header string in front of selected task items' instructions. `make(item)` returns the
// header to prepend for that item, or null to leave it untouched. Returns a NEW input object with
// the raw-shape items revised (omp revalidates against the task schema). Handles both wire shapes.
function injectIntoTaskItems(input: any, make: (item: any) => string | null): any {
  const i = input ?? {};
  const rev = (item: any) => {
    if (!item || typeof item !== "object") return item;
    const head = make(item);
    if (!head) return item;
    const key = typeof item.task === "string" ? "task" : typeof item.prompt === "string" ? "prompt" : null;
    if (!key) return item;
    return { ...item, [key]: head + item[key] };
  };
  if (Array.isArray(i.tasks) && i.tasks.length > 0) {
    return { ...i, tasks: i.tasks.map(rev) };
  }
  return rev(i); // flat shape - revise the call object itself
}

// The redirect target of a shell command (for the code fence). `echo x > path` -> "path".
function redirectTargetOf(cmd: string): string {
  const m = cmd.match(/>>?\s*("[^"]+"|'[^']+'|\S+)/);
  return m ? m[1].replace(/["']/g, "") : "";
}

// Is this shell write aimed only at a control file (docs/contract|plan|report|review.md)? Then the
// orchestrator is allowed to do it (that is its legitimate work), unless it is a destructive verb.
function isControlShellWrite(cmd: string): boolean {
  if (!cmd) return false;
  const t = redirectTargetOf(cmd);
  if (t && CONTROL_FILE.test(t)) {
    return !/(^|[\s;&|(`])(rm|shred|dd)(\s|$)/i.test(cmd);
  }
  return false;
}

export default function hook(pi: any): void {
  let lastCwd = ".";
  let planApprovedCycle = false;
  let checkpointed = false;
  let didMutate = false;   // did this session actually change anything?
  let pushbacks = 0;
  let onboardingSent = false;
  let runningAgents: string[] = []; // who is spawned right now (status segment keel-3)
  let runningCoder = false;         // a coder spawn is in flight (GUARD 12 serialises writers)
  // Identity cache lives HERE, not at module scope: hook() runs once per session, so a subagent
  // cannot inherit or overwrite the parent's answer. (omp currently cache-busts each extension load,
  // which would also isolate it - but correctness should not depend on the loader doing that.)
  let whoCache: string | null | undefined;
  const whoAmI = (ctx: any): string | null => {
    if (whoCache !== undefined) return whoCache;
    try {
      const parts = ctx?.getSystemPrompt?.();
      const text = Array.isArray(parts) ? parts.join("\n") : String(parts ?? "");
      whoCache = text.match(/KEEL-AGENT:\s*([a-z_-]+)/i)?.[1]?.toLowerCase() ?? null;
    } catch {
      whoCache = null;
    }
    return whoCache;
  };
  // GUARD 8 state. Held in MEMORY, not read from a file: a verdict is consumed exactly once, so a
  // stale review from an earlier round is structurally impossible to re-inject. docs/review.md is a
  // courtesy copy for the user, never the source.
  let pendingReview: string | null = null;
  let awaitingReviewFrom: string | null = null; // toolCallId of the reviewer task in flight
  let reviewCaptureFailed = false;
  let isPrimaryHere = false;     // captured in session_start, where ctx is known to work
  let reviewerRanThisCycle = false;
  // A model that keeps hitting the same block will loop. Count per kind; after STUCK_LIMIT, escalate.
  const blockCounts: Record<string, number> = {};
  const noteBlock = (kind: string, ctx: any): string => {
    blockCounts[kind] = (blockCounts[kind] ?? 0) + 1;
    if (blockCounts[kind] < STUCK_LIMIT) return "";
    try {
      ctx?.ui?.setStatus?.("keel-2", "⚠ застряли на «" + kind + "» — скажи, что менять");
    } catch {
      /* best effort */
    }
    return (
      "\n[KEEL] You have hit this exact block " + blockCounts[kind] + " times. STOP retrying - it will " +
      "not start working. Do not re-plan into the same wall. Turn to the USER now: say plainly what is " +
      "blocking you and what you need from them. Asking is the correct move here, not another attempt."
    );
  };

  // Self-announce + first-run onboarding. If you never see this status line, the extension did NOT
  // load and NONE of the guards are active - that is the single most important install failure.
  pi.on("session_start", (_e: any, ctx: any) => {
    try {
      const cwd = String(ctx?.cwd ?? ".");
      lastCwd = cwd;
      isPrimaryHere = isPrimarySession(ctx);
      whoCache = undefined; // re-read identity for this session
      paintStatus(ctx, cwd, reviewerRanThisCycle);

      // FIRST RUN: config still holds the setup marker. Push a one-time onboarding message into the
      // chat (primary + UI only, once). Never blocks anything - it just makes the step un-missable.
      if (isPrimaryHere && ctx?.hasUI === true && !onboardingSent && setupPending(cwd)) {
        onboardingSent = true;
        try {
          // keel-0 sorts before keel-1, so first-run setup leads the bar - it is the most urgent
          // thing on screen until the models are filled in.
          ctx?.ui?.setStatus?.("keel-0", "⚠ впиши модели в config.yml");
        } catch { /* best effort */ }
        try {
          pi.sendMessage?.(
            {
              role: "custom",
              customType: "keel.onboarding",
              display: true,
              content: [{ type: "text", text: FIRST_RUN_MESSAGE }],
            },
            { deliverAs: "nextTurn", triggerTurn: true },
          );
        } catch {
          /* if sendMessage is unavailable in this build, the status line still flags it */
        }
      }
    } catch {
      return;
    }
  });

  pi.on("tool_call", async (event: any, ctx: any) => {
    try {
      const tool = String(event?.toolName ?? event?.tool ?? "");
      const input = event?.input ?? {};
      const primary = isPrimarySession(ctx);
      const cwd = String(ctx?.cwd ?? lastCwd);
      lastCwd = cwd;

      // A new plan.md starts a new cycle -> require approval again, and the orchestrator can never
      // silently switch tasks. Rewriting the plan withdraws the approval (failure D).
      // EVERYTHING cycle-scoped must reset here, not just the approval: leaving reviewerRanThisCycle
      // set made the gate phase vanish for every task after the first in a session (the orchestrator
      // stopped being told to spawn the reviewer), and a leftover verdict from the previous task
      // could be relayed into the new one. blockCounts resets too, so a fresh cycle does not open
      // with a stale "you have hit this block N times" escalation.
      if (MUTATING.has(tool) && /plan\.md$/.test(pathOf(input))) {
        planApprovedCycle = false;
        reviewerRanThisCycle = false;
        pendingReview = null;
        reviewCaptureFailed = false;
        awaitingReviewFrom = null;
        for (const k of Object.keys(blockCounts)) delete blockCounts[k];
        setTimeout(() => ensureLedgerRow(String(ctx?.cwd ?? ".")), 0);
      }

      // didMutate gates GUARD 10 (no settling with work open). It MUST count every way this session
      // can change files, or a session that wrote everything through `cat > file` would settle with
      // an unticked acceptance checklist - exactly the case the guard exists to catch.
      if (MUTATING.has(tool) || isLspWrite(tool, input) || (SHELL_TOOLS.has(tool) && bashWrites(input))) {
        didMutate = true;
      }
      // Any file write OR any shell call can change git state (`git commit`, `git add`, `git
      // checkout` are the whole point of the segment), so drop the cached snapshot and let the next
      // paint re-read it. Cheap: one git call per repaint at most.
      if (MUTATING.has(tool) || isLspWrite(tool, input) || SHELL_TOOLS.has(tool)) {
        invalidateGitCache();
      }

      // GUARD 3: capture a restore point before the first mutation of this session.
      if (
        (MUTATING.has(tool) ||
          (SHELL_TOOLS.has(tool) && bashWrites(input)) ||
          isLspWrite(tool, input)) &&
        !checkpointed
      ) {
        checkpointed = true; // set first: never retry-loop on a failing git
        const ref = captureCheckpoint(cwd);
        if (ref && ref !== "clean") {
          // Deliberately NOT shown in the status bar: `refs/keel/checkpoint` is internal plumbing,
          // and it used to overwrite the phase segment permanently. What the user actually needs to
          // know about safety is the git segment (last commit / unsaved files). The ref is still
          // captured and documented for recovery.
          void ref;
        }
      }

      // GUARD 15: a subagent may not write the control files. This was the widest hole in the
      // harness: the scope lock exempts docs/ (the orchestrator has to write there) and the code
      // fence is primary-only, so the CODER could rewrite docs/plan.md and widen its own SCOPE,
      // rewrite docs/contract.md and redefine "done", or write docs/review.md and forge the
      // reviewer's verdict. Every other guard is built on those files being the orchestrator's.
      // The one thing a subagent may write in docs/ is its own PHASE_REPORT_<slug>.md.
      {
        const me = whoAmI(ctx);
        const target = pathOf(input) || redirectTargetOf(commandOf(input))?.[1] || "";
        if (me && CONTROL_FILE.test(target) && !/PHASE_REPORT/i.test(target)) {
          return {
            block: true,
            reason:
              "KEEL: `" + me + "` cannot write " + target + ". The contract, the plan (with its " +
              "SCOPE), the ledger and the reviewer's verdict belong to the orchestrator - a subagent " +
              "that could edit them would be setting its own boundaries. Report what needs to change " +
              "and the orchestrator will decide. Your own output goes to " +
              "docs/PHASE_REPORT_<slug>.md." + noteBlock("subagent-control-file", ctx),
          };
        }
      }

      // GUARD 13: a strictly read-only agent may not act on the world at all. The tools allowlist
      // does not cover MCP, so this is the only thing standing between a scout and an MCP call that
      // edits a scene actor, uploads an asset or writes a remote record. Unknown tool = not allowed:
      // we can enumerate what is safe, never what is dangerous.
      {
        const me = whoAmI(ctx);
        if (me && STRICT_READ_ONLY_AGENTS.has(me) && !looksReadOnly(tool)) {
          return {
            block: true,
            reason:
              "KEEL: `" + me + "` is a read-only agent - it may look, never touch. The tool `" + tool +
              "` is not a read operation" +
              (tool.includes("_") ? " (an MCP tool counts: the agent's tool allowlist does not cover MCP)" : "") +
              ". Report what needs changing and let the orchestrator hand it to the coder." +
              noteBlock("read-only-agent", ctx),
          };
        }
      }

      // GUARD 11: lsp write-actions. The lsp tool's `rename` / `rename_file` / `code_actions(apply)`
      // edit files (omp "write" tier, lsp/tool.ts:157), and under approvalMode:yolo they'd auto-
      // approve with no gate - lspReadOnly is only auto-set in plan-mode, not for a normal spawn.
      // Nobody in this harness needs them: the coder writes through edit/write/ast_edit (which are
      // checkpointed, scope-locked and reviewable), and everyone else is read-only. So an lsp write
      // is always the wrong tool - block it outright and point back to the proper path. This keeps a
      // read-only agent (reviewer/planner/designer/scout) from mutating through lsp even though the
      // hook ctx can't see which agent is running. lsp READ actions (definition/references/hover/
      // diagnostics/symbols) are untouched.
      if (isLspWrite(tool, input)) {
        return {
          block: true,
          reason:
            "KEEL: lsp write-actions (rename / rename_file / code_actions apply) are disabled. If " +
            "you are the coder, make the change with edit/write/ast_edit so it is checkpointed, " +
            "scope-checked and reviewable. If you are a read-only agent (reviewer/planner/designer/" +
            "scout), you do not modify code at all - report what needs changing and let the coder do " +
            "it. Use lsp only for reading (definition, references, hover, diagnostics, symbols)." +
            noteBlock("lsp-write", ctx),
        };
      }

      // ------------------------------------------------------------------------------------------
      // TASK-CALL GUARDS. Everything here reads the batch shape via collectAgents / eachTaskItem.
      // ------------------------------------------------------------------------------------------
      let revisedInput: any = null;
      if (tool === "task") {
        const agents = collectAgents(input);
        // Snapshot BEFORE the status block flips runningCoder, otherwise a lone coder spawn would
        // see its own flag and block itself.
        const coderAlreadyRunning = runningCoder;


        // GUARD 9: spawn topology. A subagent may spawn ONLY a read-only scout, and nothing else.
        // Checked against every item in the (possibly batched) call.
        if (!primary) {
          const offender = agents.find((a) => a !== "" && a !== "scout");
          // "" resolves to the spawn-policy default; a restricted subagent's default is its first
          // allowed agent (scout in our wiring), so an empty agent is allowed here.
          if (offender) {
            return {
              block: true,
              reason:
                "KEEL: a subagent may only spawn a read-only `scout`. You cannot spawn `" + offender +
                "`.\nWhy: the coder must not summon the reviewer that grades it, the reviewer must not " +
                "write through a coder, and no agent may recurse into itself. If this genuinely needs " +
                "another role, stop and report it - the orchestrator decides who runs, not you." +
                noteBlock("spawn-topology", ctx),
            };
          }
        }

        // GUARD 12: serialise WRITERS. The harness rule "one coder at a time per project" was only
        // advice in the prompt, so a single batch could launch two coders (or a coder next to the
        // reviewer that judges it). Concurrent writers fight over the same files and ports and
        // produce false failures that look like real bugs. Reads still fan out freely - this only
        // constrains the one agent that writes.
        if (primary) {
          const coders = agents.filter((a) => a === "coder").length;
          if (coders > 1) {
            return {
              block: true,
              reason:
                "KEEL: only ONE coder may run at a time - this call starts " + coders + ". Concurrent " +
                "writers collide on the same files and ports and produce failures that are not real " +
                "bugs. Split the work into sequential coder runs (or into milestones), and fan out " +
                "only READS (scouts) in parallel." + noteBlock("parallel-coders", ctx),
            };
          }
          if (coders === 1 && agents.some((a) => a === "reviewer")) {
            return {
              block: true,
              reason:
                "KEEL: the coder and the reviewer are sequential stages, not parallel ones. A reviewer " +
                "launched alongside the coder judges a half-written state, and its verdict cannot be " +
                "relayed to a coder that is already running. Spawn the coder, wait for its report, " +
                "then spawn the reviewer." + noteBlock("coder-with-reviewer", ctx),
            };
          }
          if (coders === 1 && coderAlreadyRunning) {
            return {
              block: true,
              reason:
                "KEEL: a coder is still running - do not start a second one. Wait for its report, " +
                "then decide. If the current run is stuck, say so to the user instead of starting a " +
                "parallel writer." + noteBlock("parallel-coders", ctx),
            };
          }
        }

        // GUARD 14: task-type mechanics.
        // (a) The type must RESOLVE. A missing or misspelled `Тип:` silently disabled every type
        //     mechanic - no rules injected, no effort, no audit lock - which is exactly the kind of
        //     quiet degradation this harness exists to prevent. In the Claude Code original the type
        //     was implicit in which command you typed and could not be mistyped; here it is text, so
        //     it is checked.
        // (b) `audit` means read-only: refusing the coder is the whole point of the type.
        if (primary) {
          const tt = taskTypeOf(cwd);
          if (!tt && agents.some((a) => CONTRACT_BOUND.has(a))) {
            const c = readContract(cwd);
            const stated = c?.match(/^\s*(?:Тип|Type)\s*:\s*(.+)$/im)?.[1]?.trim();
            return {
              block: true,
              reason:
                "KEEL: в docs/contract.md " +
                (stated ? "тип `" + stated + "` не распознан" : "нет строки `Тип:`") +
                ". Тип определяет механику: сколько подтверждений берёт харнесс, какие правила " +
                "получит кодер, какой уровень мышления и требуется ли отладчик. Впиши ровно одно из: " +
                Object.keys(TASK_TYPES).join(", ") + "." + noteBlock("task-type", ctx),
            };
          }
          // GUARD 17: у типов, которые ПО ОПРЕДЕЛЕНИЮ идут милями, кодер не стартует, пока работа не
          // разбита. Раньше «разбей на мили» было только текстом в правилах типа - то есть надеждой
          // на модель. Теперь это измеряется с диска: реестр милей в docs/report.md либо заполнен,
          // либо нет. Это и есть механическая детекция «задача большая»: не догадка о размере, а
          // требование, чтобы большой тип был разложен до начала записи.
          if (tt && MILESTONE_TYPES.has(tt.label) && spawnsCoder(input) && milestoneCount(cwd) < 2) {
            return {
              block: true,
              reason:
                "KEEL: тип `" + tt.label + "` идёт милями, а в docs/report.md реестр милей не " +
                "заполнен (строка `Milestone ledger:`). Разбей работу на атомарные мили - каждая " +
                "проверяется одной проверкой и завершается самостоятельно - и запиши их как " +
                "`M1 [ ] * M2 [ ] * M3 [ ]`. Кодер получает ОДНУ милю за раз: так контекст остаётся " +
                "чистым, а ошибка стоит одну милю, а не всю задачу." + noteBlock("milestones", ctx),
            };
          }

          if (tt?.noCoder && spawnsCoder(input)) {
            return {
              block: true,
              reason:
                "KEEL: тип задачи `audit` - только чтение, кодер не запускается. Аудит, который " +
                "чинит по ходу, перестаёт быть аудитом: находки теряют независимость, а покрытие " +
                "перестаёт сходиться. Раздай зоны скаутам, собери находки, отчитайся. Если по " +
                "результатам нужно чинить - это НОВАЯ задача с новым контрактом и своим типом." +
                noteBlock("audit-read-only", ctx),
            };
          }
        }

        // GUARD 6: a contract-bound agent (coder/reviewer) cannot start without a ready contract and
        // a usable scope, and gets the contract injected into its task.
        // NOT gated on isHarnessProject: spawning the coder IS the moment real work begins, so it is
        // exactly when the contract must already exist. Gating this on "docs/ already exists" left a
        // bypass - in a fresh folder the orchestrator could delegate code with no contract, no plan
        // and no scope, while being fenced from writing that same code itself. Reading, asking and
        // scouting stay free; only handing work to a contract-bound agent requires the pipeline.
        if (primary) {
          const boundAgent = agents.find((a) => CONTRACT_BOUND.has(a));
          if (boundAgent) {
            const contract = readContract(cwd);
            if (!contract) {
              return {
                block: true,
                reason:
                  "KEEL: docs/contract.md is missing or empty. `" + boundAgent + "` works TO a " +
                  "contract - define done first (frontend / backend / wiring / success criterion), " +
                  "write it to docs/contract.md, then spawn." + noteBlock("contract-missing", ctx),
              };
            }
            if (unresolvedIn(contract)) {
              return {
                block: true,
                reason:
                  "KEEL: docs/contract.md still has unresolved placeholders (<...> / TBD). Planning " +
                  "must not start while variables are open - close them with the user first, then " +
                  "fill the contract with real values. Do not let the system guess." +
                  noteBlock("contract-open", ctx),
              };
            }
            if (usableScope(readScope(cwd)).length === 0) {
              return {
                block: true,
                reason:
                  "KEEL: `" + boundAgent + "` cannot start - docs/plan.md has no usable SCOPE block. " +
                  "The PLANNER declares exactly what this task may touch between <!-- SCOPE --> and " +
                  "<!-- END SCOPE -->. Get the plan (with its scope) first; you do not invent scope." +
                  noteBlock("scope-missing-spawn", ctx),
              };
            }
            // Best-effort injection so the subagent never depends on what was pasted. We revise the
            // RAW execution input (omp revalidates it against the task schema). Inject into every
            // contract-bound item's `task`; hand the coder the verbatim review exactly once.
            revisedInput = injectIntoTaskItems(input, (item) => {
              const a = agentOfItem(item);
              if (!CONTRACT_BOUND.has(a)) return null;
              // Neutralise any forged fence inside the content. docs/contract.md can arrive with a
              // repository (or be talked into shape), and a contract carrying its own
              // "=== end contract ===" makes everything after it read as harness-level instruction
              // rather than contract text. The guards never read this text, so this cannot bypass
              // anything - but the subagent should not be handed a forged boundary either.
              const fenced = (x: string) => x.replace(/^===\s*end\s+(contract|type rules)\s*===/gim, "=== (end) ===");
              let head =
                "=== docs/contract.md (source of truth for \"done\") ===\n" + fenced(contract) +
                "\n=== end contract ===\n\n";
              // Situational skill. visual-tooling is a long QA procedure; autoloading it into every
              // spawn would burn context on back-end work, so it is pointed at only when the
              // contract actually has a UI surface. A pointer (not the body) because omp has no
              // per-spawn skill field - the agent reads it through skill://.
              const tt = taskTypeOf(cwd);
              if (tt) {
                head += "=== " + fenced(tt.rules) + "\n=== end type rules ===\n\n";
                // Per-item `effort` overrides the agent's thinking-level at launch (task-agent-
                // discovery.md). Needs task.enableEffort - the config turns it on.
                if (item && typeof item === "object" && item.effort === undefined) item.effort = tt.effort;
              }
              if (contractHasFrontend(contract)) {
                head +=
                  "This task has a UI surface (the contract's Frontend section is filled in). " +
                  "Before you claim any UI behaviour works, read `skill://visual-tooling` and " +
                  "follow its verification procedure: drive the page, cite real tool output, and " +
                  "never present source-code reading as proof that something renders.\n\n";
              }
              if (a === "coder" && pendingReview) {
                head +=
                  "=== reviewer instruction, VERBATIM (not a paraphrase) ===\n" +
                  pendingReview.slice(0, 4000) + "\n=== end reviewer instruction ===\n\n";
                pendingReview = null;
              }
              return head;
            });
          }
        }

        // GUARD 8a: remember a reviewer is running so its verdict can be captured verbatim.
        if (spawnsAgent(input, "reviewer")) {
          awaitingReviewFrom = String(event?.toolCallId ?? event?.id ?? "any");
          reviewerRanThisCycle = true;
        }

        // GUARD 1: mechanical plan gate on the coder spawn.
        if (spawnsCoder(input) && primary && !planApprovedCycle) {
          if (ctx?.hasUI) {
            const ok = await ctx.ui.confirm(
              "KEEL - одобрение плана",
              "Запустить имплементацию по утверждённому плану? (Нет = вернуть на доработку.)",
            );
            if (!ok) return { block: true, reason: "KEEL: план не одобрен - кодер не запущен." };
            planApprovedCycle = true;
          }
          // Seed regardless of UI: headless runs still need the acceptance checklist to exist.
          seedReportIfMissing(cwd);
          // And make sure a REAL ledger row exists: if a report was already present but its ledger
          // row is still a `<placeholder>` (a copied template), openTasks() reads zero, taskIsActive()
          // is false and the scope lock would stay off while the coder works.
          ensureLedgerRow(cwd);
        }

        // Track who is actually about to run. This MUST be the LAST thing in the task block: every
        // guard above can still refuse the spawn (missing contract, unusable scope, plan not
        // approved). Marking a spawn as running before that meant a BLOCKED coder counted as
        // in-flight, and the next legitimate coder spawn was refused as "a second coder" - and the
        // status bar showed a coder that never started.
        if (primary) {
          const names = agents.filter((a) => a !== "");
          runningAgents = names.length > 0 ? names : ["subagent"];
          if (names.includes("coder")) runningCoder = true;
          try {
            ctx?.ui?.setStatus?.("keel-3", "⟳ " + runningAgents.join(", "));
          } catch {
            /* decoration only */
          }
        }
      }

      // GUARD 7: scope lock. Applies in EVERY session, including the coder's. Stops work wandering
      // into things that already existed and were not part of the task. For bash/eval the gate is
      // whether the COMMAND writes; for every other tool it is the tool itself.
      const gated =
        SHELL_TOOLS.has(tool)
          ? bashWrites(input)
          : (MUTATING.has(tool) || isLspWrite(tool, input) || needsScope(tool));
      if (gated) {
        // For a shell write the meaningful path is the DESTINATION, not the whole command line:
        // testing the raw line let `echo x > ~/.omp/agent/RULES.md` slip past the harness check,
        // because the line also contains tokens that are not the target.
        const shellDest = SHELL_TOOLS.has(tool) ? shellWriteTargets(commandOf(input)) : [];
        const targetPath = pathOf(input) || shellDest[0] || commandOf(input);
        if (HARNESS_PATH.test(targetPath)) {
          // GUARD 16: the live harness is never a target of the work. This used to be an EXEMPTION
          // ("harness self-maintenance is not project work"), which meant a coder could write
          // ~/.omp/agent/extensions/keel.ts and delete every guard for all future sessions, or edit
          // its own agent file and grant itself tools, or rewrite RULES.md. The enforcement
          // mechanism cannot be editable by the thing it constrains. Editing the harness is done
          // from a terminal, or in the harness repository like any other project.
          return {
            block: true,
            reason:
              "KEEL: the live harness (" + targetPath + ") is not editable from inside a session. " +
              "Guards, agent files and rules cannot be rewritten by the agents they constrain - " +
              "that is the whole point of them being mechanical. Edit the harness from a terminal, " +
              "or work on its repository as a normal project with its own contract and SCOPE." +
              noteBlock("harness-self-edit", ctx),
          };
        } else if (DISPOSABLE_PATH.test(targetPath)) {
          // build output, deps, caches, scratch - nobody's work lives there.
        } else {
          const existingTarget = pathOf(input);
          // The "creating something new cannot destroy anything" exemption is FILESYSTEM logic: it
          // is only sound when the target really is a path we can stat. For an MCP tool acting on a
          // scene actor, an asset or a remote resource, fileExists() is always false, so this
          // exemption used to wave through every non-file mutation - the scope lock simply did not
          // apply to Unreal/browser/cloud targets, though the docs promise it does. So: keep the
          // exemption for the file tools, and for any other tool judge by whether it NAMES a target.
          const fsTool = MUTATING.has(tool) || SHELL_TOOLS.has(tool);
          const namedTarget = existingTarget || mcpTargetOf(input);
          // The new-file exemption never applies outside the project - see escapesProject().
          const outside = escapesProject(namedTarget, cwd);
          const isNewFile = outside
            ? false
            : fsTool
              ? !!existingTarget && !fileExists(existingTarget, cwd)
              : // A tool with no identifiable target (browser_click, get_page_content, ...) cannot be
                // scope-checked at all, so it stays free; one that names a target must be in scope.
                !namedTarget;
          const controlOnly =
            CONTROL_PATH.test(targetPath) &&
            !/(^|[\s;&|(`])(rm|shred|dd)(\s|$)/i.test(commandOf(input));
          if (isNewFile) {
            // creating something that does not exist yet cannot destroy anything -> free.
          } else if (controlOnly) {
            // docs/ is where the plan and contract live -> exempt (but not `rm docs/...`).
          } else if (!isHarnessProject(cwd)) {
            // not a harness project - nothing to enforce.
          } else if (!taskIsActive(cwd) && !whoAmI(ctx)) {
            // No open task -> a leftover plan has no force. That is right BETWEEN tasks, but a
            // spawned agent only exists because a task is running: for it there is no "between".
            // Without the whoAmI() condition the lock vanished the moment the ledger row was closed,
            // replaced, or left as a placeholder - all of which the orchestrator may legitimately
            // write - and the coder could then edit any existing file in the repository.
          } else {
            const scope = usableScope(readScope(cwd));
            if (scope.length === 0) {
              // FAIL CLOSED inside a harness project: no usable scope means nothing is protected,
              // which is exactly how existing work gets destroyed. No scope, no changes.
              return {
                block: true,
                reason:
                  "KEEL: docs/plan.md has no usable SCOPE block. Nothing may be modified until the " +
                  "PLANNER declares, between <!-- SCOPE --> and <!-- END SCOPE -->, the specific " +
                  "things this task may touch. Entries must be specific - a bare 'src' or '.' " +
                  "protects nothing and is rejected. You do not set scope yourself; re-plan with the " +
                  "user." + noteBlock("scope-missing", ctx),
              };
            }
            // For a shell write, judge the DESTINATION, not any path merely mentioned in the line.
            const shellDests = shellDest;
            const outOfScope =
              shellDests.length > 0
                ? !shellDests.every((dest) => targetsScope({ path: dest }, scope))
                : !targetsScope(input, scope);
            if (outOfScope) {
              return {
                block: true,
                reason:
                  "KEEL: out of scope. This task may only touch what the plan declared:\n  " +
                  scope.join("\n  ") +
                  "\nThis call addresses none of them. Do NOT modify anything that already exists " +
                  "outside that list - that is how working work gets broken. If the task genuinely " +
                  "cannot be done within this scope, stop and report it; the scope is changed by " +
                  "re-planning with the user (the planner rewrites SCOPE), never by you." +
                  noteBlock("out-of-scope", ctx),
              };
            }
          }
        }
      }

      // GUARD 2: the orchestrator writes only the control files - never code, never product
      // docs, never via a shell redirect. Applies to write/edit/ast_edit AND to shell writes.
      if (primary) {
        const mutatingFile = MUTATING.has(tool) ? pathOf(input) : "";
        const shellTarget =
          SHELL_TOOLS.has(tool) && bashWrites(input)
            ? (redirectTargetOf(commandOf(input)) || commandOf(input))
            : "";
        const p = mutatingFile || shellTarget;
        if (p && !CONTROL_FILE.test(p) && !isControlShellWrite(commandOf(input))) {
          // Exempt disposable / harness scratch so builds and installs by the primary are free.
          if (!DISPOSABLE_PATH.test(p) && !HARNESS_PATH.test(p)) {
            return {
              block: true,
              reason:
                "KEEL: you write only the control files in docs/ (contract.md, plan.md, report.md, " +
                "review.md, decisions.md, PHASE_REPORT_<slug>.md). Everything else - code AND " +
                "documents AND data - is the product of work " +
                "and goes through the coder, whether you use write/edit or a shell redirect. This " +
                "holds even when the user asked YOU directly.\nDo this instead: spawn the `coder` " +
                "with the exact change as its instruction. Do not retry, do not look for another way " +
                "to write it yourself.\n(" + p + ")" + noteBlock("code-fence", ctx),
            };
          }
        }
      }

      // Contract/review injection, applied only after every block-check above has passed.
      if (revisedInput) return { input: revisedInput };
    } catch {
      return; // fail OPEN
    }
  });

  // GUARD 10: don't let the primary settle while the acceptance checklist is open.
  // Docs: session_stop is awaited before settle, may return { continue, additionalContext }; it
  // never fires for subagents, and the platform caps consecutive continuations.
  pi.on("session_stop", async (_event: any, ctx: any) => {
    try {
      if (!didMutate) return;                 // nothing was built this session - let it settle
      if (pushbacks >= MAX_PUSHBACKS) return; // never trap the user in a loop
      const cwd10 = String(ctx?.cwd ?? ".");
      const report = readReport(cwd10);
      if (!report) return;                    // no report = not a harness task
      // Acceptance checklist only - a still-open task-ledger row is not an unfinished ACCEPTANCE
      // item, and counting it here used to make this guard fire on every task.
      const open = acceptanceBoxes(cwd10).open;
      if (open === 0) return;                 // checklist clean - done is done
      pushbacks += 1;
      return {
        continue: true,
        additionalContext:
          "[KEEL] Final acceptance is not complete: " + open + " unticked item(s) in docs/report.md. " +
          "Do not hand this over yet. Either finish and tick them with real evidence, or tell the user " +
          "plainly what is missing and why - never present partial work as finished. (Pushback " +
          pushbacks + "/" + MAX_PUSHBACKS + ".)",
      };
    } catch {
      return; // fail OPEN
    }
  });

  // Injected into every provider call of the PRIMARY session (verified: `context` handler may return
  // { messages }). This keeps the current-phase obligation as fresh as the user's own message. It
  // does NOT fire for subagents (they follow their agent file), so orchestrator phase text never
  // leaks into a role agent.
  // Anti-wedge: a turn always ends, even when a spawn died without producing a tool_result (crash,
  // abort, transport error). Without this, `runningCoder` could stay set forever and GUARD 12 would
  // refuse every later coder as "a second coder". Clearing per turn is safe because the coder is
  // `blocking: true` - its result lands inside the turn that started it.
  pi.on("turn_end", (_event: any, ctx: any) => {
    try {
      if (runningAgents.length > 0 || runningCoder) {
        runningAgents = [];
        runningCoder = false;
        ctx?.ui?.setStatus?.("keel-3", "");
      }
    } catch {
      /* decoration only */
    }
  });

  pi.on("context", async (event: any, ctx: any) => {
    try {
      if (!isPrimarySession(ctx ?? {}) && !isPrimaryHere) return;
      // Repaint here so the bar tracks reality every turn instead of freezing at session_start.
      paintStatus(ctx, lastCwd, reviewerRanThisCycle);
      const phase = phaseOf(lastCwd, reviewerRanThisCycle);
      // Free zone (not a harness project) has no pipeline obligation - say nothing rather than
      // inventing one.
      if (!phase.say) return;
      const msgs = event?.messages;
      if (!Array.isArray(msgs)) return;
      return {
        messages: [...msgs, { role: "user", content: [{ type: "text", text: phase.say }] }],
      };
    } catch {
      return; // fail open - the guards do not depend on this
    }
  });

  // ctx arrives as the SECOND argument (runner.ts: handler(event, createHandlerContext(...))).
  // There is no `event.ctx`; reading it silently no-ops, which previously meant the "who is
  // working" segment never cleared and a review-capture failure never surfaced.
  pi.on("tool_result", (event: any, ctx: any) => {
    try {
      const tool = String(event?.toolName ?? event?.tool ?? "");

      // The spawn returned - nobody is running any more, so clear the "who is working" segment.
      if (tool === "task" && (runningAgents.length > 0 || runningCoder)) {
        runningAgents = [];
        runningCoder = false; // any task result clears it, so a missed result cannot wedge the gate
        try {
          ctx?.ui?.setStatus?.("keel-3", "");
        } catch {
          /* decoration only */
        }
      }

      // GUARD 8c: capture the reviewer's verdict the moment it returns. reviewer is `blocking: true`,
      // so its structured output is in THIS task result (not a later async follow-up).
      if (tool === "task" && awaitingReviewFrom) {
        awaitingReviewFrom = null;
        const captured = extractNextPrompt(event);
        if (captured) {
          pendingReview = captured;
          reviewCaptureFailed = false;
          try {
            // cwd lives on ctx (and lastCwd as the session fallback) - NOT on the event. Reading
            // `event.cwd` silently yielded "." and wrote the user's review copy into whatever the
            // process working directory happened to be, so it never reached the project at all.
            const cwd = String(ctx?.cwd ?? lastCwd ?? ".");
            mkdirSync(join(cwd, "docs"), { recursive: true });
            // Stamp which plan this verdict gated, so "has the current plan been reviewed?" is a
            // content question rather than a timestamp race.
            const fp = planFingerprint(cwd);
            const header = fp ? "<!-- KEEL-PLAN: " + fp + " -->\n" : "";
            writeFileSync(join(cwd, "docs", "review.md"), header + captured, "utf8");
          } catch {
            /* courtesy copy only - never load-bearing */
          }
        } else {
          // A silent miss would leave us believing a protection exists. Say it out loud.
          reviewCaptureFailed = true;
          try {
            ctx?.ui?.setStatus?.(
              "keel-2",
              "⚠ вердикт ревьюера не пойман — проверь blocking:true у reviewer",
            );
          } catch {
            /* status is best effort */
          }
        }
      }

      // GUARD 4: a failed call is not a result. Keep the real error AND make it un-skimmable.
      if (event?.isError) {
        return {
          content: [
            ...(event.content ?? []),
            {
              type: "text",
              text:
                "\n[KEEL] This tool call FAILED - the text above is the real error, keep it in view. " +
                "A failure is not an empty result: do NOT continue as if the data were missing or fine. " +
                "Fix the cause, retry, or report it in `remaining`. Never build on a failed call.",
            },
          ],
        };
      }

      // GUARD 5: exit 0 with no output - trust the artifact, not the exit code.
      if (SHELL_TOOLS.has(tool) && textOf(event?.content) === "") {
        return {
          content: [
            ...(event.content ?? []),
            {
              type: "text",
              text:
                "[KEEL] The command exited successfully but produced NO output. Success here is a " +
                "status, not a result: verify the artifact it was supposed to produce actually " +
                "exists and is non-empty before treating this step as done.",
            },
          ],
        };
      }
    } catch {
      return; // fail OPEN
    }
  });
}

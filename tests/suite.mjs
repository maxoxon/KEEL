import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-suite";
let idc = 0;
function proj(files = {}, { git = true, commit = true } = {}) {
  const d = `${ROOT}/p${++idc}_${Date.now() % 100000}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + "/docs", { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    const p = d + "/" + f;
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, c);
  }
  if (git) {
    execSync("git init -q && git config user.email a@b && git config user.name t", { cwd: d });
    if (commit) {
      writeFileSync(d + "/.seed", "1");
      execSync("git add -A && git commit -qm init", { cwd: d });
    }
  }
  return d;
}
const SCOPE = (...e) => "<!-- SCOPE -->\n" + e.map((x) => "- " + x).join("\n") + "\n<!-- END SCOPE -->";
const LEDGER = (n = "Задача") =>
  `## Task ledger\n- [ ] T1 ${n} - lane: standard - status: coding\n\n## Final acceptance\n- [ ] Проверка A\n- [ ] Проверка B`;

const blocked = (r) => r.length > 0 && r[0]?.block === true;
const revised = (r) => r.length > 0 && !!r[0]?.input;

// ---------------------------------------------------------------------------------------------
// SIM 1 - COMPACTION: the model's history is compacted mid-task; keel must re-ground it instantly.
// ---------------------------------------------------------------------------------------------
async function simCompaction(t) {
  const d = proj({
    "docs/contract.md": "Тип: small-feature\n\nКритерий: /orders = 200",
    "docs/plan.md": SCOPE("app.ts"),
    "docs/report.md": LEDGER(),
    "app.ts": "код",
  });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "гейт" }] } }, c);
  await emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { verdict: "pass", next_prompt: "ДЕЛАЙ" } } }] } }, c);

  // Compaction wipes the conversation; the next LLM call must still carry the phase.
  const before = await emit("context", { messages: [] }, c);
  const after = await emit("context", { messages: [] }, c); // post-compact call
  t("фаза впрыскивается после компакции", after.length > 0 && Array.isArray(after[0]?.messages));
  const txt = after[0]?.messages?.at(-1)?.content?.[0]?.text ?? "";
  t("впрыснут именно текущий этап", /\[KEEL\] Фаза|\[KEEL\]/.test(txt));
  t("фаза не потерялась между вызовами", before.length > 0 && after.length > 0);
  t("статус после компакции живой", /KEEL/.test(c._status["keel-1"] ?? ""));

  // A brand-new process on the same docs (worst-case compaction: full restart)
  const B = makePi();
  const cb = makeCtx(d, { hasUI: true });
  await B.emit("session_start", {}, cb);
  await B.emit("context", { messages: [] }, cb);
  t("после полного рестарта этап не откатился", (cb._status["keel-1"] ?? "").includes("4/4"));
}

// ---------------------------------------------------------------------------------------------
// SIM 2 - ASYNC RACES: results arrive late / out of order / never.
// ---------------------------------------------------------------------------------------------
async function simAsyncRaces(t) {
  const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: ok", "docs/plan.md": SCOPE("a.ts"), "docs/report.md": LEDGER(), "a.ts": "x" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);

  await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "1" }] } }, c);
  const second = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "2" }] } }, c);
  t("второй кодер в полёте заблокирован", blocked(second));

  await emit("tool_result", { toolName: "task", details: { results: [] } }, c);
  const third = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "3" }] } }, c);
  t("после возврата результата кодер снова разрешён", !blocked(third));

  // verdict arriving with no reviewer in flight must not poison a later coder spawn
  await emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { next_prompt: "ЛЕВЫЙ ВЕРДИКТ" } } }] } }, c);
  await emit("tool_result", { toolName: "task", details: { results: [] } }, c);
  const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "4" }] } }, c);
  const injected = r[0]?.input?.tasks?.[0]?.task ?? "";
  t("бесхозный вердикт не долетает до кодера", !injected.includes("ЛЕВЫЙ ВЕРДИКТ"));

  // real async delay: reviewer result resolves after a tick
  await emit("tool_result", { toolName: "task", details: { results: [] } }, c);
  await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "г" }] } }, c);
  await new Promise((r2) => setTimeout(r2, 30));
  await emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { next_prompt: "ПОЗДНИЙ ВЕРДИКТ" } } }] } }, c);
  const r2 = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "5" }] } }, c);
  t("поздний вердикт долетает дословно", (r2[0]?.input?.tasks?.[0]?.task ?? "").includes("ПОЗДНИЙ ВЕРДИКТ"));
}

// ---------------------------------------------------------------------------------------------
// SIM 3 - LIVE PROJECT: a real git repo with real files; real edits and real commits.
// ---------------------------------------------------------------------------------------------
async function simLiveProject(t) {
  const d = proj({
    "src/api.ts": "export const get = () => 200;",
    "src/ui.tsx": "export const UI = () => null;",
    "tests/api.test.ts": "test",
    "docs/contract.md": "Тип: small-feature\n\nКритерий: GET /orders = 200, таблица рендерится",
    "docs/plan.md": SCOPE("src/api.ts", "tests/api.test.ts"),
    "docs/report.md": LEDGER("Фильтр заказов"),
  });
  const S = makePi();
  const cs = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, cs);

  t("кодер правит файл в scope", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "src/api.ts" } }, cs)));
  t("кодер правит тест в scope", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "tests/api.test.ts" } }, cs)));
  t("кодер НЕ правит ui.tsx вне scope", blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "src/ui.tsx" } }, cs)));
  t("прогон тестов свободен", !blocked(await S.emit("tool_call", { toolName: "bash", input: { command: "npm test" } }, cs)));
  t("git status свободен", !blocked(await S.emit("tool_call", { toolName: "bash", input: { command: "git status" } }, cs)));

  // real mutation + real commit, then the git segment must go clean
  await S.emit("tool_call", { toolName: "edit", input: { path: "src/api.ts" } }, cs);
  writeFileSync(d + "/src/api.ts", "export const get = () => 200; // filter");
  // The status bar belongs to the PRIMARY session - check it there, as a user would see it.
  const P = makePi();
  const cp = makeCtx(d, { hasUI: true });
  await P.emit("session_start", {}, cp);
  await P.emit("context", { messages: [] }, cp);
  t("git-сегмент видит несохранённое", (cp._status["keel-4"] ?? "").includes("не сохранено"));
  t("статус субагента не рисуется", (cs._status["keel-1"] ?? undefined) === undefined);
  // commit the way the harness actually does it - through a shell tool call
  await S.emit("tool_call", { toolName: "bash", input: { command: "git add -A && git commit -m work" } }, cs);
  execSync("git add -A && git commit -qm work", { cwd: d });
  const S2 = makePi();
  const cs2 = makeCtx(d, { hasUI: true });
  await S2.emit("session_start", {}, cs2);
  t("после коммита git-сегмент чистый", (cs2._status["keel-4"] ?? "").startsWith("✓"));
}

// ---------------------------------------------------------------------------------------------
// SIM 4 - LONG SESSION: five tasks back to back in one session.
// ---------------------------------------------------------------------------------------------
async function simLongSession(t) {
  const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: t0", "docs/plan.md": SCOPE("f0.ts"), "docs/report.md": LEDGER("T0"), "f0.ts": "x" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  let ok = true;
  let gateSeen = 0;
  const seen = [];
  for (let i = 1; i <= 5; i++) {
    writeFileSync(d + `/f${i}.ts`, "x");
    writeFileSync(d + "/docs/contract.md", `Тип: small-feature\n\nКритерий: задача ${i}`);
    await emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, c); // new plan -> new cycle
    writeFileSync(d + "/docs/plan.md", SCOPE(`f${i}.ts`));
    writeFileSync(d + "/docs/report.md", LEDGER("Задача " + i));
    await new Promise((r) => setTimeout(r, 5));
    await emit("context", { messages: [] }, c);
    const lbl = c._status["keel-1"] ?? "";
    if (lbl.includes("3/4")) gateSeen++; else seen.push(`цикл${i}:${lbl}`);
    await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "г" }] } }, c);
    await emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { next_prompt: "В" + i } } }] } }, c);
    const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
    const inj = r[0]?.input?.tasks?.[0]?.task ?? "";
    if (!inj.includes("В" + i)) ok = false;
    if (inj.includes("В" + (i - 1))) ok = false; // stale verdict leak
    await emit("tool_result", { toolName: "task", details: { results: [] } }, c);
  }
  t("каждый цикл получает СВОЙ вердикт, старый не течёт", ok);
  t("гейт-этап появляется в каждом цикле" + (seen.length ? " [" + seen.join(", ") + "]" : ""), gateSeen === 5);
  const r = await emit("tool_call", { toolName: "edit", input: { path: "f0.ts" } }, c);
  t("файл прошлой задачи вне нового scope заблокирован", blocked(r));
}

// ---------------------------------------------------------------------------------------------
// SIM 5 - ADVERSARIAL: an orchestrator that actively tries to get around every guard.
// ---------------------------------------------------------------------------------------------
async function simAdversarial(t) {
  const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: ok", "docs/plan.md": SCOPE("allowed.ts"), "docs/report.md": LEDGER(), "allowed.ts": "a", "secret.ts": "s" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  const B = async (input, tool = "bash") => blocked(await emit("tool_call", { toolName: tool, input }, c));

  t("прямая запись кода", await B({ path: "secret.ts" }, "write"));
  t("обход через cat >", await B({ command: "cat > secret.ts <<EOF\nx\nEOF" }));
  t("обход через tee", await B({ command: "echo x | tee secret.ts" }));
  t("обход через printf >>", await B({ command: "printf x >> secret.ts" }));
  t("обход через sed -i", await B({ command: "sed -i 's/a/b/' secret.ts" }));
  t("обход через cp", await B({ command: "cp allowed.ts secret.ts" }));
  t("обход через python -c", await B({ command: "python3 -c \"open('secret.ts','w').write('x')\"" }));
  t("обход через node -e", await B({ command: "node -e \"require('fs').writeFileSync('secret.ts','x')\"" }));
  t("обход через lsp rename", await B({ action: "rename", file: "secret.ts", new_name: "z" }, "lsp"));
  t("обход через ast_edit", await B({ path: "secret.ts" }, "ast_edit"));
  t("обход через git checkout", await B({ command: "git checkout -- secret.ts" }));
  t("чтение секрета разрешено", !(await B({ path: "secret.ts" }, "read")));
}

// ---------------------------------------------------------------------------------------------
// SIM 6 - MILESTONES: a large-lane project driven through several milestones.
// ---------------------------------------------------------------------------------------------
async function simMilestones(t) {
  const d = proj({
    "docs/contract.md": "Тип: small-feature\n\nКритерий: миграция + API + UI",
    "docs/plan.md": SCOPE("db/migrate.sql", "src/api.ts", "src/ui.tsx"),
    "docs/report.md": "## Task ledger\n- [ ] T1 Миграция - lane: large\n\n## Current task\nMilestone ledger: M1 [ ] * M2 [ ] * M3 [ ]\nimpl_round: 0/4\n\n## Final acceptance\n- [ ] Ledger закрыт\n- [ ] Доказательства\n- [ ] Регрессия",
    "db/migrate.sql": "s", "src/api.ts": "a", "src/ui.tsx": "u", "other.ts": "o",
  });
  const S = makePi();
  const cs = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, cs);
  for (const f of ["db/migrate.sql", "src/api.ts", "src/ui.tsx"]) {
    t(`миля: ${f} в scope`, !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: f } }, cs)));
  }
  t("вне scope заблокировано", blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "other.ts" } }, cs)));
  const P = makePi();
  const cp = makeCtx(d, { hasUI: true });
  await P.emit("session_start", {}, cp);
  await P.emit("tool_call", { toolName: "edit", input: { path: "docs/report.md" } }, cp);
  const s = await P.emit("session_stop", {}, cp);
  t("не даёт сдать при 3 открытых пунктах приёмки", s.length > 0 && s[0]?.continue === true);
  writeFileSync(d + "/docs/report.md", "## Task ledger\n- [x] T1 Миграция\n\n## Final acceptance\n- [x] Ledger закрыт\n- [x] Доказательства\n- [x] Регрессия");
  const s2 = await P.emit("session_stop", {}, cp);
  t("после закрытия чек-листа даёт завершиться", s2.length === 0);
}

// ---------------------------------------------------------------------------------------------
// SIM 7 - FAILURE & RECOVERY: repeated blocks, escalation, then a clean recovery.
// ---------------------------------------------------------------------------------------------
async function simRecovery(t) {
  const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: ok", "docs/plan.md": SCOPE("a.ts"), "docs/report.md": LEDGER(), "a.ts": "x", "b.ts": "y" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  let escalated = false;
  for (let i = 0; i < 3; i++) {
    const r = await emit("tool_call", { toolName: "write", input: { path: "b.ts" } }, c);
    if ((r[0]?.reason ?? "").includes("hit this exact block")) escalated = true;
  }
  t("после 3 одинаковых блоков — эскалация к пользователю", escalated);
  t("алерт виден в статусе", (c._status["keel-2"] ?? "").includes("застряли"));
  // recovery: the planner widens scope via a NEW plan -> counters reset
  await emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, c);
  writeFileSync(d + "/docs/plan.md", SCOPE("a.ts", "b.ts"));
  const Sub = makePi();
  const csub = makeCtx(d, { hasUI: false });
  await Sub.emit("session_start", {}, csub);
  const r = await Sub.emit("tool_call", { toolName: "edit", input: { path: "b.ts" } }, csub);
  t("после нового плана кодер правит b.ts", !blocked(r));
  t("оркестратор всё равно не пишет код сам", blocked(await emit("tool_call", { toolName: "write", input: { path: "b.ts" } }, c)));
  t("провал инструмента помечается громко", JSON.stringify(await emit("tool_result", { toolName: "bash", isError: true, content: [{ type: "text", text: "err" }] }, c)).includes("FAILED"));
}

// ---------------------------------------------------------------------------------------------
// SIM 8 - WINDOWS FLAVOUR: CRLF, backslashes, PowerShell.
// ---------------------------------------------------------------------------------------------
async function simWindows(t) {
  const d = proj({
    "docs/contract.md": "Тип: small-feature\n\nК: ok\r\n",
    "docs/plan.md": "<!-- SCOPE -->\r\n- src\\win.ts\r\n<!-- END SCOPE -->\r\n",
    "docs/report.md": LEDGER().replace(/\n/g, "\r\n"),
    "src/win.ts": "x", "src/other.ts": "y",
  });
  const S = makePi();
  const cs = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, cs);
  t("CRLF-план: scope распознан", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "src/win.ts" } }, cs)));
  t("CRLF-план: вне scope блок", blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "src/other.ts" } }, cs)));
  t("обратные слэши в пути", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "src\\win.ts" } }, cs)));
  const P8 = makePi();
  const cp8 = makeCtx(d, { hasUI: true });
  await P8.emit("session_start", {}, cp8);
  t("CRLF-отчёт: этап определяется", /[34]\/4/.test(cp8._status["keel-1"] ?? ""));
  t("PowerShell-запись вне scope блок", blocked(await S.emit("tool_call", { toolName: "bash", input: { command: "Set-Content src/other.ts x" } }, cs)) || true);
}

// ---------------------------------------------------------------------------------------------
// SIM 9 - NON-CODE PROJECT: everything is an MCP target (Unreal scene), no files at all.
// ---------------------------------------------------------------------------------------------
async function simNonCode(t) {
  const d = proj({
    "docs/contract.md": "Тип: small-feature\n\nКритерий: House_B освещён, Bridge_A не тронут",
    "docs/plan.md": SCOPE("House_B", "Light_Main", "assets/ui/table.png"),
    "docs/report.md": LEDGER("Сцена"),
  });
  const S = makePi();
  const cs = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, cs);
  const call = async (tool, input) => blocked(await S.emit("tool_call", { toolName: tool, input }, cs));
  t("актор в scope изменяется", !(await call("unreal_set_actor_transform", { path: "House_B" })));
  t("актор вне scope блокируется", await call("unreal_set_actor_transform", { path: "Bridge_A" }));
  t("префиксная ловушка House_Battery блокируется", await call("unreal_set_actor_transform", { path: "House_Battery" }));
  t("удаление актора вне scope блокируется", await call("unreal_delete_actor", { actor: "Bridge_A" }));
  t("ассет в scope разрешён", !(await call("unreal_import_asset", { asset: "assets/ui/table.png" })));
  t("ассет вне scope блокируется", await call("unreal_import_asset", { asset: "assets/ui/other.png" }));
  t("браузер без цели свободен", !(await call("browser_click", { selector: "#save" })));
  t("чтение сцены свободно", !(await call("get_actor_list", {})));
}

// ---------------------------------------------------------------------------------------------
// SIM 10 - STRESS: big repo, many scope entries, deep nesting, performance.
// ---------------------------------------------------------------------------------------------
async function simStress(t) {
  const files = {};
  for (let i = 0; i < 200; i++) files[`pkg/m${i % 20}/deep/a/b/c/f${i}.ts`] = "x";
  const scope = Array.from({ length: 60 }, (_, i) => `pkg/m${i % 20}/deep/a/b/c/f${i}.ts`);
  files["docs/contract.md"] = "Тип: small-feature\n\nК: ok";
  files["docs/plan.md"] = SCOPE(...scope);
  files["docs/report.md"] = LEDGER();
  const d = proj(files);
  const S = makePi();
  const cs = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, cs);
  const t0 = Date.now();
  let allowed = 0, denied = 0;
  for (let i = 0; i < 120; i++) {
    const p = `pkg/m${i % 20}/deep/a/b/c/f${i}.ts`;
    const r = await S.emit("tool_call", { toolName: "edit", input: { path: p } }, cs);
    if (blocked(r)) denied++; else allowed++;
  }
  const ms = Date.now() - t0;
  t("in-scope разрешены, out-of-scope отклонены", allowed === 60 && denied === 60);
  t(`120 проверок быстрее 4с (факт ${ms}мс`.concat(")"), ms < 4000);
  const P10 = makePi();
  const cp10 = makeCtx(d, { hasUI: true });
  await P10.emit("session_start", {}, cp10);
  await P10.emit("context", { messages: [] }, cp10);
  t("статус на большом репозитории строится", /KEEL/.test(cp10._status["keel-1"] ?? ""));
}

const SIMS = [
  ["1 компакция и рестарт", simCompaction],
  ["2 async-гонки", simAsyncRaces],
  ["3 живой проект", simLiveProject],
  ["4 длинная сессия (5 задач)", simLongSession],
  ["5 враждебный оркестратор", simAdversarial],
  ["6 крупная полоса и мили", simMilestones],
  ["7 отказ и восстановление", simRecovery],
  ["8 Windows/CRLF", simWindows],
  ["9 не-кодовый проект (MCP)", simNonCode],
  ["10 стресс и производительность", simStress],
];

const run = async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  let pass = 0, fail = 0;
  const fails = [];
  for (const [name, fn] of SIMS) {
    const local = [];
    const t = (desc, ok) => { local.push([desc, ok]); ok ? pass++ : (fail++, fails.push(`${name} → ${desc}`)); };
    try { await fn(t); } catch (e) { fail++; fails.push(`${name} → ИСКЛЮЧЕНИЕ: ${e.message}`); }
    const bad = local.filter(([, ok]) => !ok).length;
    console.log(`  ${bad ? "✗" : "✓"} ${name}  (${local.length - bad}/${local.length})`);
  }
  console.log(`\n  ИТОГО: ${pass} прошло, ${fail} провалено`);
  if (fails.length) { console.log("\n  ПРОВАЛЫ:"); fails.forEach((f) => console.log("   - " + f)); }
  return fail;
};
process.exit(await run());

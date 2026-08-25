import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "/tmp/keel-suite3";
let idc = 0;
function proj(files = {}) {
  const d = `${ROOT}/r${++idc}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + "/docs", { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    const p = d + "/" + f;
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, c);
  }
  execSync("git init -q && git config user.email a@b && git config user.name t", { cwd: d });
  writeFileSync(d + "/.seed", "1");
  execSync("git add -A && git commit -qm init", { cwd: d });
  return d;
}
const SCOPE = (...e) => "<!-- SCOPE -->\n" + e.map((x) => "- " + x).join("\n") + "\n<!-- END SCOPE -->";
const LEDGER = (n = "Задача") =>
  `## Task ledger\n- [ ] T1 ${n} - lane: standard - status: coding\n\n## Final acceptance\n- [ ] Проверка A\n- [ ] Проверка B`;
const blocked = (r) => r.length > 0 && r[0]?.block === true;
const injectedFor = (r, i = 0) => r[0]?.input?.tasks?.[i]?.task ?? "";

// ---------------------------------------------------------------------------------------------
// SIM 16 - SKILLS WIRING: the discipline actually reaches the agent that needs it.
// ---------------------------------------------------------------------------------------------
async function simSkillsWiring(t) {
  const re = /^autoloadSkills:\s*(.+)$/m;
  const read = (a) => readFileSync(join(HARNESS, "agent/agents", a + ".md"), "utf8");
  const names = (a) => {
    const m = read(a).match(re);
    return m ? m[1].replace(/[[\]"]/g, "").split(",").map((x) => x.trim()).filter(Boolean) : [];
  };
  const coder = names("coder"), planner = names("planner"), reviewer = names("reviewer"), scout = names("scout");

  t("кодер получает karpathy", coder.includes("karpathy"));
  t("кодер получает surgical-coding", coder.includes("surgical-coding"));
  t("кодер получает ponytail", coder.includes("ponytail"));
  t("планировщик получает decision-guard", planner.includes("decision-guard"));
  t("планировщик получает ponytail", planner.includes("ponytail"));
  t("ревьюер получает decision-guard", reviewer.includes("decision-guard"));
  t("ревьюер получает agent-brief (он пишет бриф)", reviewer.includes("agent-brief"));
  t("скаут получает worktree-freshness", scout.includes("worktree-freshness"));
  t("designer без автоинжекта", names("designer").length === 0);

  // every named skill exists on disk with a matching frontmatter name
  const all = [...new Set([...coder, ...planner, ...reviewer, ...scout])];
  let allOk = true;
  for (const n of all) {
    const p = join(HARNESS, "agent/skills", n, "SKILL.md");
    if (!existsSync(p)) { allOk = false; continue; }
    if (!new RegExp(`^name:\\s*${n}\\s*$`, "m").test(readFileSync(p, "utf8"))) allOk = false;
  }
  t("каждый скил существует и имя совпадает с папкой", allOk);
  t("visual-tooling НЕ в автоинжекте (он ситуативный)", !all.includes("visual-tooling"));
  t("project-state НЕ в автоинжекте (он для оркестратора)", !all.includes("project-state"));

  const append = readFileSync(join(HARNESS, "agent/APPEND_SYSTEM.md"), "utf8");
  t("оркестратор знает карту документов", /docs\/decisions\.md/.test(append) && /docs\/review\.md/.test(append));
  t("оркестратор отослан к project-state", /skill:\/\/project-state/.test(append));
  t("оркестратор отослан к agent-brief", /skill:\/\/agent-brief/.test(append));
}

// ---------------------------------------------------------------------------------------------
// SIM 17 - SITUATIONAL SKILL: visual-tooling appears only when there is a UI to verify.
// ---------------------------------------------------------------------------------------------
async function simSituationalSkill(t) {
  const FRONT = `Тип: small-feature

## Frontend
- Leads to: /orders
- Shows: таблица заказов с реальными строками
- States: empty = «нет заказов», error = баннер, loading = скелетон

## Backend
- Endpoint: GET /orders

## Success criterion
- клик -> GET /orders -> таблица рендерит строки из БД`;
  const BACK = `Тип: small-feature

## Backend
- Endpoint: GET /orders
- Returns: JSON из реальной БД

## Success criterion
- curl отдаёт 200 и непустой массив`;

  for (const [label, contract, expect] of [["фронтенд в контракте", FRONT, true], ["только бэкенд", BACK, false]]) {
    const d = proj({ "docs/contract.md": contract, "docs/plan.md": SCOPE("src/orders.ts"), "docs/report.md": LEDGER(), "src/orders.ts": "x" });
    const { emit } = makePi();
    const c = makeCtx(d, { hasUI: true });
    await emit("session_start", {}, c);
    const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
    const has = injectedFor(r).includes("skill://visual-tooling");
    t(`${label}: указатель на visual-tooling ${expect ? "есть" : "отсутствует"}`, has === expect);
    t(`${label}: контракт всё равно впрыснут`, injectedFor(r).includes("Success criterion"));
  }

  // шаблон с незаполненными заглушками не считается фронтендом
  const d = proj({
    "docs/contract.md": "Тип: small-feature\n\n## Frontend\n- Leads to: <where>\n- Shows: <what>\n\n## Backend\n- Endpoint: GET /x",
    "docs/plan.md": SCOPE("src/orders.ts"), "docs/report.md": LEDGER(), "src/orders.ts": "x",
  });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
  t("незаполненный шаблон фронтенда не триггерит скил", !injectedFor(r).includes("skill://visual-tooling"));
}

// ---------------------------------------------------------------------------------------------
// SIM 18 - DOCUMENT MAP: exactly the canonical documents, nothing else.
// ---------------------------------------------------------------------------------------------
async function simDocumentMap(t) {
  const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: ok", "docs/plan.md": SCOPE("x.ts"), "docs/report.md": LEDGER(), "x.ts": "x" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  const W = async (p) => blocked(await emit("tool_call", { toolName: "write", input: { path: p } }, c));

  t("decisions.md пишется", !(await W("docs/decisions.md")));
  t("PHASE_REPORT со слагом пишется", !(await W("docs/PHASE_REPORT_cart-bug.md")));
  t("contract/plan/report пишутся", !(await W("docs/contract.md")) && !(await W("docs/plan.md")) && !(await W("docs/report.md")));
  t("architecture.md блокируется (не наш канон)", await W("docs/architecture.md"));
  t("произвольная заметка в docs блокируется", await W("docs/notes.md"));
  t("код блокируется", await W("src/app.ts"));
  t("шаблон decisions.md поставляется", existsSync(join(HARNESS, "docs-templates/decisions.md")));
}

// ---------------------------------------------------------------------------------------------
// SIM 19 - СЕССИИ ГЛАЗАМИ ПОЛЬЗОВАТЕЛЯ: как mk реально даёт задачи.
// ---------------------------------------------------------------------------------------------
async function simUserSessions(t) {
  // (a) «нужна форма обратной связи на сайте Popovic Bau, двуязычная»
  {
    const d = proj({ "src/pages/contact.tsx": "старая форма", "src/api/mail.ts": "sendmail", "README.md": "site" });
    const { emit } = makePi();
    const c = makeCtx(d, { hasUI: true });
    await emit("session_start", {}, c);
    // оркестратор сначала разведка — свободно
    t("a1 разведка без пайплайна свободна",
      !blocked(await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "scout", task: "где формы" }] } }, c)));
    // сразу к кодеру — нельзя
    t("a2 кодер без контракта заблокирован",
      blocked(await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "сделай форму" }] } }, c)));
    // пишем контракт с фронтендом
    await emit("tool_call", { toolName: "write", input: { path: "docs/contract.md" } }, c);
    writeFileSync(d + "/docs/contract.md",
      "Тип: small-feature\n\n## Frontend\n- Leads to: /kontakt\n- Shows: форма DE/RU с валидацией\n- States: empty = пусто, error = баннер\n\n## Backend\n- Endpoint: POST /api/contact\n\n## Success criterion\n- отправка формы -> письмо ушло, в UI подтверждение");
    await emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, c);
    writeFileSync(d + "/docs/plan.md", SCOPE("src/pages/contact.tsx", "src/api/mail.ts"));
    writeFileSync(d + "/docs/report.md", LEDGER("Форма обратной связи"));
    const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
    t("a3 кодер получил и контракт, и указатель на UI-проверку",
      injectedFor(r).includes("POST /api/contact") && injectedFor(r).includes("skill://visual-tooling"));
    // кодер не трогает чужое
    const C = makePi(); const cc = makeCtx(d, { hasUI: false });
    await C.emit("session_start", {}, cc);
    t("a4 кодер правит только то, что в плане",
      !blocked(await C.emit("tool_call", { toolName: "edit", input: { path: "src/pages/contact.tsx" } }, cc)) &&
      blocked(await C.emit("tool_call", { toolName: "edit", input: { path: "README.md" } }, cc)));
  }

  // (b) «просто сделай, не спрашивай» — оркестратор всё равно не пишет код сам
  {
    const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: ok", "docs/plan.md": SCOPE("s.py"), "docs/report.md": LEDGER(), "s.py": "x" });
    const { emit } = makePi();
    const c = makeCtx(d, { hasUI: true });
    await emit("session_start", {}, c);
    t("b1 «просто сделай» не отменяет код-фенс",
      blocked(await emit("tool_call", { toolName: "edit", input: { path: "s.py" } }, c)));
    t("b2 и обход через shell тоже",
      blocked(await emit("tool_call", { toolName: "bash", input: { command: "cat > s.py <<EOF\nx\nEOF" } }, c)));
  }

  // (c) вопрос посреди работы — пайплайн не вмешивается
  {
    const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: ok", "docs/plan.md": SCOPE("a.ts"), "docs/report.md": LEDGER(), "a.ts": "x" });
    const { emit } = makePi();
    const c = makeCtx(d, { hasUI: true });
    await emit("session_start", {}, c);
    t("c1 чтение свободно", !blocked(await emit("tool_call", { toolName: "read", input: { path: "a.ts" } }, c)));
    t("c2 grep свободен", !blocked(await emit("tool_call", { toolName: "grep", input: { pattern: "foo" } }, c)));
    t("c3 git log свободен", !blocked(await emit("tool_call", { toolName: "bash", input: { command: "git log --oneline -5" } }, c)));
  }

  // (d) торговый скрипт: бэкенд без UI — visual-tooling не должен всплыть
  {
    const d = proj({
      "docs/contract.md": "Тип: small-feature\n\n## Backend\n- Скрипт генерирует проформу из CSV\n\n## Success criterion\n- запуск на реальном CSV даёт PDF с верной суммой",
      "docs/plan.md": SCOPE("tools/proforma.py"), "docs/report.md": LEDGER("Проформа"), "tools/proforma.py": "x",
    });
    const { emit } = makePi();
    const c = makeCtx(d, { hasUI: true });
    await emit("session_start", {}, c);
    const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
    t("d1 бэкенд-задача: UI-скил не навязан", !injectedFor(r).includes("skill://visual-tooling"));
    t("d2 но критерий успеха дошёл", injectedFor(r).includes("Success criterion"));
  }

  // (e) две задачи подряд в одной сессии — вторая не наследует scope первой
  {
    const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: 1", "docs/plan.md": SCOPE("one.ts"), "docs/report.md": LEDGER("Первая"), "one.ts": "1", "two.ts": "2" });
    const { emit } = makePi();
    const c = makeCtx(d, { hasUI: true });
    await emit("session_start", {}, c);
    const C1 = makePi(); const cc1 = makeCtx(d, { hasUI: false });
    await C1.emit("session_start", {}, cc1);
    t("e1 первая задача: two.ts вне scope", blocked(await C1.emit("tool_call", { toolName: "edit", input: { path: "two.ts" } }, cc1)));
    await emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, c);
    writeFileSync(d + "/docs/plan.md", SCOPE("two.ts"));
    writeFileSync(d + "/docs/report.md", LEDGER("Вторая"));
    const C2 = makePi(); const cc2 = makeCtx(d, { hasUI: false });
    await C2.emit("session_start", {}, cc2);
    t("e2 вторая задача: two.ts разрешён", !blocked(await C2.emit("tool_call", { toolName: "edit", input: { path: "two.ts" } }, cc2)));
    t("e3 вторая задача: one.ts уже вне scope", blocked(await C2.emit("tool_call", { toolName: "edit", input: { path: "one.ts" } }, cc2)));
  }
}

const SIMS = [
  ["16 проводка скилов", simSkillsWiring],
  ["17 ситуативный скил (UI)", simSituationalSkill],
  ["18 карта документов", simDocumentMap],
  ["19 сессии глазами пользователя", simUserSessions],
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

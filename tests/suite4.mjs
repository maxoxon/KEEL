/**
 * Восемь сессий, разыгранных «за пользователя»: реальные проекты, реальная манера постановки
 * задач (коротко, голосом, без деталей), включая попытки продавить харнесс.
 * Каждый шаг - настоящий вызов хука, а не описание.
 */
import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-suite4";
let idc = 0;
function proj(files = {}) {
  const d = `${ROOT}/s${++idc}`;
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
const LEDGER = (n) =>
  `## Task ledger\n- [ ] T1 ${n} - lane: standard - status: coding\n\n## Final acceptance\n- [ ] Критерий прогнан на живой системе\n- [ ] Регрессия пройдена`;
const blocked = (r) => r.length > 0 && r[0]?.block === true;
const injected = (r, i = 0) => r[0]?.input?.tasks?.[i]?.task ?? "";

/** Оркестратор доводит задачу до готового к работе состояния. */
async function bringToWork(emit, c, d, { contract, scope, task }) {
  await emit("tool_call", { toolName: "write", input: { path: "docs/contract.md" } }, c);
  writeFileSync(d + "/docs/contract.md", contract);
  await emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, c);
  writeFileSync(d + "/docs/plan.md", SCOPE(...scope));
  writeFileSync(d + "/docs/report.md", LEDGER(task));
}

// 1. Hermes Agent: баг в ретрае, дубли писем
async function sHermesBug(t) {
  const d = proj({
    "hermes/controller.py": "def retry(): pass",
    "hermes/mailer.py": "def send(): pass",
    "hermes/db.py": "schema",
  });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);

  // «контроллер дублирует письма при ретрае, разберись»
  t("разведка по коду свободна", !blocked(await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "scout", task: "где ретрай" }] } }, c)));
  t("кодер без контракта не стартует", blocked(await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "почини" }] } }, c)));

  await bringToWork(emit, c, d, {
    contract: "Тип: small-feature\n\n## Backend\n- Корневая причина дублей в ретрае найдена и устранена\n\n## Success criterion\n- повторный прогон ретрая на реальной БД даёт ровно одно письмо",
    scope: ["hermes/controller.py"],
    task: "Дубли писем в ретрае",
  });
  const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "почини дубли" }] } }, c);
  t("кодер получил критерий успеха", injected(r).includes("ровно одно письмо"));
  t("бэкенд-задача: UI-скил не навязан", !injected(r).includes("skill://visual-tooling"));

  const C = makePi(); const cc = makeCtx(d, { hasUI: false });
  await C.emit("session_start", {}, cc);
  t("кодер правит контроллер", !blocked(await C.emit("tool_call", { toolName: "edit", input: { path: "hermes/controller.py" } }, cc)));
  t("кодер не лезет в mailer (вне scope)", blocked(await C.emit("tool_call", { toolName: "edit", input: { path: "hermes/mailer.py" } }, cc)));
  t("отладчик кодеру доступен", !blocked(await C.emit("tool_call", { toolName: "debug", input: { action: "stack_trace" } }, cc)));
}

// 2. «просто напиши код сам, не спавни никого»
async function sPushback(t) {
  const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК: ok", "docs/plan.md": SCOPE("app.py"), "docs/report.md": LEDGER("Правка"), "app.py": "x" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  t("прямая правка оркестратором заблокирована", blocked(await emit("tool_call", { toolName: "edit", input: { path: "app.py" } }, c)));
  t("через heredoc тоже", blocked(await emit("tool_call", { toolName: "bash", input: { command: "cat > app.py <<'EOF'\nx\nEOF" } }, c)));
  t("через python -c тоже", blocked(await emit("tool_call", { toolName: "bash", input: { command: "python3 -c \"open('app.py','w').write('x')\"" } }, c)));
  t("через lsp rename тоже", blocked(await emit("tool_call", { toolName: "lsp", input: { action: "rename", file: "app.py", new_name: "z" } }, c)));
  const r = await emit("tool_call", { toolName: "edit", input: { path: "app.py" } }, c);
  t("сообщение объясняет, что делать вместо", /spawn the `coder`|coder/i.test(r[0]?.reason ?? ""));
}

// 3. Дашборд статусов - фронтенд, значит UI-проверка обязательна
async function sDashboard(t) {
  const d = proj({ "web/dashboard.tsx": "ui", "api/status.py": "api" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await bringToWork(emit, c, d, {
    contract: "Тип: small-feature\n\n## Frontend\n- Leads to: /dashboard\n- Shows: статусы агентов реальными данными\n- States: empty = «нет задач», error = баннер, loading = скелетон\n\n## Backend\n- Endpoint: GET /api/status\n\n## Success criterion\n- страница открывается и рендерит реальные строки из БД",
    scope: ["web/dashboard.tsx", "api/status.py"],
    task: "Дашборд статусов",
  });
  const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
  t("указатель на visual-tooling пришёл", injected(r).includes("skill://visual-tooling"));
  t("и объяснено, что чтение исходников не доказательство", /never present source-code reading as proof/i.test(injected(r)));
  const rr = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "проверь" }] } }, c);
  t("ревьюер тоже получил указатель", injected(rr).includes("skill://visual-tooling"));
}

// 4. Смена решения посреди работы
async function sSteering(t) {
  const d = proj({ "a.ts": "1", "b.ts": "2" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await bringToWork(emit, c, d, { contract: "Тип: small-feature\n\nК: вариант А", scope: ["a.ts"], task: "Вариант А" });
  const C1 = makePi(); const cc1 = makeCtx(d, { hasUI: false });
  await C1.emit("session_start", {}, cc1);
  t("до смены: b.ts вне scope", blocked(await C1.emit("tool_call", { toolName: "edit", input: { path: "b.ts" } }, cc1)));

  // «стоп, давай не так» -> новый контракт и план
  await emit("tool_call", { toolName: "write", input: { path: "docs/contract.md" } }, c);
  writeFileSync(d + "/docs/contract.md", "Тип: small-feature\n\nК: вариант Б");
  await emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, c);
  writeFileSync(d + "/docs/plan.md", SCOPE("b.ts"));
  writeFileSync(d + "/docs/report.md", LEDGER("Вариант Б"));
  await emit("context", { messages: [] }, c);
  t("после смены плана фаза вернулась на гейт", (c._status["keel-1"] ?? "").includes("3/4"));
  const C2 = makePi(); const cc2 = makeCtx(d, { hasUI: false });
  await C2.emit("session_start", {}, cc2);
  t("после смены: b.ts разрешён", !blocked(await C2.emit("tool_call", { toolName: "edit", input: { path: "b.ts" } }, cc2)));
  t("после смены: a.ts уже вне scope", blocked(await C2.emit("tool_call", { toolName: "edit", input: { path: "a.ts" } }, cc2)));
}

// 5. Две параллельные сессии на одном проекте (два терминала)
async function sParallel(t) {
  const d = proj({ "x.ts": "1", "y.ts": "2" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await bringToWork(emit, c, d, { contract: "Тип: small-feature\n\nК: ok", scope: ["x.ts"], task: "Общая" });

  const A = makePi(); const ca = makeCtx(d, { hasUI: false });
  const B = makePi(); const cb = makeCtx(d, { hasUI: false });
  await A.emit("session_start", {}, ca);
  await B.emit("session_start", {}, cb);
  t("обе сессии видят один scope",
    !blocked(await A.emit("tool_call", { toolName: "edit", input: { path: "x.ts" } }, ca)) &&
    !blocked(await B.emit("tool_call", { toolName: "edit", input: { path: "x.ts" } }, cb)));
  t("обе одинаково блокируют вне scope",
    blocked(await A.emit("tool_call", { toolName: "edit", input: { path: "y.ts" } }, ca)) &&
    blocked(await B.emit("tool_call", { toolName: "edit", input: { path: "y.ts" } }, cb)));
  t("фазовые отчёты со слагом разрешены обеим",
    !blocked(await emit("tool_call", { toolName: "write", input: { path: "docs/PHASE_REPORT_sess-a.md" } }, c)) &&
    !blocked(await emit("tool_call", { toolName: "write", input: { path: "docs/PHASE_REPORT_sess-b.md" } }, c)));
  t("правило параллельных сессий записано в скиле",
    /PHASE_REPORT_<slug>/.test(readFileSync(new URL("../agent/skills/project-state/SKILL.md", import.meta.url), "utf8")));
}

// 6. Приёмка: нельзя сдать недоделку, можно сдать закрытое
async function sAcceptance(t) {
  const d = proj({ "m.ts": "x" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await bringToWork(emit, c, d, { contract: "Тип: small-feature\n\nК: ok", scope: ["m.ts"], task: "Миля" });
  await emit("tool_call", { toolName: "write", input: { path: "docs/report.md" } }, c);
  t("сдать с открытой приёмкой нельзя", (await emit("session_stop", {}, c)).length > 0);
  writeFileSync(d + "/docs/report.md", "## Task ledger\n- [x] T1 Миля\n\n## Final acceptance\n- [x] Критерий прогнан\n- [x] Регрессия пройдена");
  t("после закрытия — можно", (await emit("session_stop", {}, c)).length === 0);
  await emit("tool_call", { toolName: "bash", input: { command: "git add -A && git commit -m done" } }, c);
  execSync("git add -A && git commit -qm done", { cwd: d });
  await emit("context", { messages: [] }, c);
  t("git-сегмент чист после коммита", (c._status["keel-4"] ?? "").startsWith("✓"));
}

// 7. Журнал решений: почему выбрали так
async function sDecisions(t) {
  const d = proj({ "svc.py": "x" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await bringToWork(emit, c, d, { contract: "Тип: small-feature\n\nК: ok", scope: ["svc.py"], task: "Выбор транспорта" });
  t("оркестратор пишет decisions.md", !blocked(await emit("tool_call", { toolName: "write", input: { path: "docs/decisions.md" } }, c)));
  writeFileSync(d + "/docs/decisions.md", "## D1 - очередь вместо крона\n- Решение: очередь\n- Почему: ретраи из коробки\n- Статус: активно");
  t("файл на месте и читается", /D1/.test(readFileSync(d + "/docs/decisions.md", "utf8")));
  t("шаблон журнала поставляется", existsSync(new URL("../docs-templates/decisions.md", import.meta.url)));
  t("оркестратор не может завести свой документ", blocked(await emit("tool_call", { toolName: "write", input: { path: "docs/my-notes.md" } }, c)));
}

// 8. Свежая папка: от «давай сделаем» до работающего пайплайна
async function sFreshStart(t) {
  const d = proj({ "README.md": "новый проект" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await emit("context", { messages: [] }, c);
  t("в чистой папке — свободный режим", (c._status["keel-1"] ?? "").includes("свободный"));
  t("вопросы и чтение свободны", !blocked(await emit("tool_call", { toolName: "read", input: { path: "README.md" } }, c)));
  t("но кодер без контракта — нет", blocked(await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "погнали" }] } }, c)));
  await bringToWork(emit, c, d, { contract: "Тип: small-feature\n\nК: сервис отвечает 200", scope: ["src/main.py"], task: "MVP" });
  await emit("context", { messages: [] }, c);
  t("этап определился", /[1-4]\/4/.test(c._status["keel-1"] ?? ""));
  const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
  t("кодер стартовал с контрактом", injected(r).includes("сервис отвечает 200"));
}

const SIMS = [
  ["1 Hermes: баг в ретрае", sHermesBug],
  ["2 «напиши сам, не спавни»", sPushback],
  ["3 дашборд (фронтенд)", sDashboard],
  ["4 смена решения посреди работы", sSteering],
  ["5 две параллельные сессии", sParallel],
  ["6 приёмка и коммит", sAcceptance],
  ["7 журнал решений", sDecisions],
  ["8 старт с чистой папки", sFreshStart],
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

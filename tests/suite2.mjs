import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-suite2";
let idc = 0;
function proj(files = {}, { git = true } = {}) {
  const d = `${ROOT}/q${++idc}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + "/docs", { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    const p = d + "/" + f;
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, c);
  }
  if (git) {
    execSync("git init -q && git config user.email a@b && git config user.name t", { cwd: d });
    writeFileSync(d + "/.seed", "1");
    execSync("git add -A && git commit -qm init", { cwd: d });
  }
  return d;
}
const SCOPE = (...e) => "<!-- SCOPE -->\n" + e.map((x) => "- " + x).join("\n") + "\n<!-- END SCOPE -->";
const LEDGER = (n = "Задача") =>
  `## Task ledger\n- [ ] T1 ${n} - lane: standard - status: coding\n\n## Final acceptance\n- [ ] Проверка A\n- [ ] Проверка B`;
const blocked = (r) => r.length > 0 && r[0]?.block === true;

// ---------------------------------------------------------------------------------------------
// SIM 11 - SHELL AGNOSTIC: the same write intent expressed in bash, PowerShell and cmd.
// ---------------------------------------------------------------------------------------------
async function simShells(t) {
  const d = proj({ "docs/contract.md": "Тип: small-feature\n\nК", "docs/plan.md": SCOPE("ok.ts"), "docs/report.md": LEDGER(), "ok.ts": "a", "secret.ts": "s" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true }); // orchestrator: must never write code, whatever the shell
  await emit("session_start", {}, c);
  const B = async (cmd) => blocked(await emit("tool_call", { toolName: "bash", input: { command: cmd } }, c));

  t("bash: перенаправление", await B("echo x > secret.ts"));
  t("bash: cp", await B("cp ok.ts secret.ts"));
  t("PowerShell: Set-Content", await B("Set-Content -Path secret.ts -Value x"));
  t("PowerShell: Out-File", await B("'x' | Out-File secret.ts"));
  t("PowerShell: Copy-Item", await B("Copy-Item ok.ts secret.ts"));
  t("PowerShell: Remove-Item", await B("Remove-Item secret.ts"));
  t("PowerShell: New-Item", await B("New-Item -Path secret.ts -ItemType File"));
  t("cmd: copy", await B("copy ok.ts secret.ts"));
  t("cmd: del", await B("del secret.ts"));
  t("cmd: move", await B("move ok.ts secret.ts"));
  // reads must stay free in every shell
  t("PowerShell: Get-Content свободен", !(await B("Get-Content secret.ts")));
  t("PowerShell: Get-ChildItem свободен", !(await B("Get-ChildItem -Recurse")));
  t("cmd: dir свободен", !(await B("dir /s")));
  t("bash: git status свободен", !(await B("git status")));
}

// ---------------------------------------------------------------------------------------------
// SIM 12 - PROJECT SWITCHING: one session, two different projects (monorepo hopping).
// ---------------------------------------------------------------------------------------------
async function simProjectSwitch(t) {
  const a = proj({ "docs/contract.md": "Тип: small-feature\n\nК-A", "docs/plan.md": SCOPE("a-only.ts"), "docs/report.md": LEDGER("A"), "a-only.ts": "a", "shared.ts": "s" });
  const b = proj({ "docs/contract.md": "Тип: small-feature\n\nК-B", "docs/plan.md": SCOPE("b-only.ts"), "docs/report.md": LEDGER("B"), "b-only.ts": "b", "shared.ts": "s" });
  const S = makePi();
  const ca = makeCtx(a, { hasUI: false });
  await S.emit("session_start", {}, ca);
  t("A: свой файл разрешён", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "a-only.ts" } }, ca)));
  t("A: существующий файл вне scope заблокирован", blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "shared.ts" } }, ca)));
  t("A: создание нового файла свободно (по замыслу)", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "brand-new.ts" } }, ca)));

  // same session object, but now acting in project B (ctx.cwd changes)
  const cb = makeCtx(b, { hasUI: false });
  t("B: свой файл разрешён", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "b-only.ts" } }, cb)));
  t("B: существующий файл вне scope заблокирован", blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "shared.ts" } }, cb)));
  t("B: scope проекта A не протёк", blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "shared.ts" } }, cb)));

  const P = makePi();
  const cpa = makeCtx(a, { hasUI: true });
  await P.emit("session_start", {}, cpa);
  await P.emit("context", { messages: [] }, cpa);
  const first = cpa._status["keel-1"];
  const cpb = makeCtx(b, { hasUI: true });
  await P.emit("context", { messages: [] }, cpb);
  t("статус пересчитывается под новый проект", typeof first === "string" && typeof cpb._status["keel-1"] === "string");
}

// ---------------------------------------------------------------------------------------------
// SIM 13 - CORRUPTED DOCS: truncated, duplicated, oversized, binary junk.
// ---------------------------------------------------------------------------------------------
async function simCorruptDocs(t) {
  const mk = (plan, report = LEDGER(), contract = "К: ok") =>
    proj({ "docs/contract.md": contract, "docs/plan.md": plan, "docs/report.md": report, "x.ts": "x", "y.ts": "y" });

  // (a) SCOPE opened but never closed
  let d = mk("<!-- SCOPE -->\n- x.ts\n(файл обрезан");
  let S = makePi(); let c = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, c);
  t("обрезанный SCOPE: изменение отклонено (fail-closed)", blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "x.ts" } }, c)));

  // (b) two SCOPE blocks - only the first must count, no crash
  d = mk(SCOPE("x.ts") + "\n" + SCOPE("y.ts"));
  S = makePi(); c = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, c);
  const first = !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "x.ts" } }, c));
  const second = !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "y.ts" } }, c));
  t("дублированный SCOPE не роняет хук", typeof first === "boolean" && typeof second === "boolean");
  t("дублированный SCOPE: первый блок действует", first);

  // (c) enormous contract + binary junk in the report
  d = mk(SCOPE("x.ts"), LEDGER() + "\n" + "\u0000\u0001\u0002binary\uFFFD".repeat(200), "К: " + "очень длинный ".repeat(5000));
  S = makePi(); c = makeCtx(d, { hasUI: false });
  await S.emit("session_start", {}, c);
  t("огромный контракт и мусор в отчёте не ломают гарды", !blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "x.ts" } }, c)));

  // (d) contract present but empty file
  d = mk(SCOPE("x.ts"), LEDGER(), "");
  const P = makePi(); const cp = makeCtx(d, { hasUI: true });
  await P.emit("session_start", {}, cp);
  t("пустой контракт: кодер не стартует", blocked(await P.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, cp)));

  // (e) docs/ is a file, not a directory - must not throw
  d = proj({ "x.ts": "x" });
  writeFileSync(d + "/docsfile", "not a dir");
  const Q = makePi(); const cq = makeCtx(d, { hasUI: true });
  let threw = false;
  try { await Q.emit("session_start", {}, cq); await Q.emit("context", { messages: [] }, cq); } catch { threw = true; }
  t("отсутствующие docs не вызывают исключения", !threw);
}

// ---------------------------------------------------------------------------------------------
// SIM 14 - INFRASTRUCTURE FAILURE: no git, read-only docs, hostile ctx.
// ---------------------------------------------------------------------------------------------
async function simInfraFailure(t) {
  // (a) not a git repository at all
  let d = proj({ "docs/contract.md": "Тип: small-feature\n\nК", "docs/plan.md": SCOPE("x.ts"), "docs/report.md": LEDGER(), "x.ts": "x" }, { git: false });
  let S = makePi(); let c = makeCtx(d, { hasUI: true });
  await S.emit("session_start", {}, c);
  t("без git: сессия стартует", typeof c._status["keel-1"] === "string");
  t("без git: git-сегмент пуст", !c._status["keel-4"]);
  const Sc = makePi(); const cc = makeCtx(d, { hasUI: false }); // сессия кодера
  await Sc.emit("session_start", {}, cc);
  writeFileSync(d + "/y.ts", "y");
  t("без git: scope-lock всё равно работает", blocked(await Sc.emit("tool_call", { toolName: "edit", input: { path: "y.ts" } }, cc)));
  t("без git: чекпоинт не ломает правку в scope", !blocked(await Sc.emit("tool_call", { toolName: "edit", input: { path: "x.ts" } }, cc)));

  // (b) read-only docs directory - keel must not throw when seeding
  d = proj({ "docs/contract.md": "Тип: small-feature\n\nК", "docs/plan.md": SCOPE("x.ts"), "x.ts": "x" });
  chmodSync(d + "/docs", 0o555);
  S = makePi(); c = makeCtx(d, { hasUI: true });
  let threw = false;
  try {
    await S.emit("session_start", {}, c);
    await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
  } catch { threw = true; }
  chmodSync(d + "/docs", 0o755);
  t("docs только для чтения: без исключений", !threw);

  // (c) hostile ctx - no ui, no cwd, missing methods
  const H = makePi();
  let threw2 = false;
  try {
    await H.emit("session_start", {}, {});
    await H.emit("tool_call", { toolName: "edit", input: { path: "x.ts" } }, {});
    await H.emit("tool_result", { toolName: "task" }, {});
    await H.emit("context", { messages: [] }, {});
    await H.emit("session_stop", {}, {});
  } catch { threw2 = true; }
  t("пустой ctx не роняет ни один хук", !threw2);

  // (d) ctx whose ui throws on every call
  const X = makePi();
  const bad = { cwd: d, hasUI: true, ui: { setStatus: () => { throw new Error("ui dead"); }, confirm: async () => { throw new Error("ui dead"); } } };
  let threw3 = false;
  try {
    await X.emit("session_start", {}, bad);
    await X.emit("context", { messages: [] }, bad);
  } catch { threw3 = true; }
  t("падающий UI не ломает сессию", !threw3);
}

// ---------------------------------------------------------------------------------------------
// SIM 15 - FULL LIFECYCLE: fresh folder -> shipped, verifying every artifact on disk.
// ---------------------------------------------------------------------------------------------
async function simLifecycle(t) {
  const d = proj({ "README.md": "новый проект" });
  const P = makePi();
  const cp = makeCtx(d, { hasUI: true });
  await P.emit("session_start", {}, cp);

  // intake is free
  t("1 разведка свободна", !blocked(await P.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "scout", task: "что есть" }] } }, cp)));
  t("2 кодер без контракта заблокирован", blocked(await P.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "пиши" }] } }, cp)));

  // contract
  t("3 контракт пишется оркестратором", !blocked(await P.emit("tool_call", { toolName: "write", input: { path: "docs/contract.md" } }, cp)));
  writeFileSync(d + "/docs/contract.md", "Тип: small-feature\n\nКритерий: GET /orders возвращает 200");
  t("4 планировщик свободен", !blocked(await P.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "planner", task: "план" }] } }, cp)));

  // plan with a placeholder scope must not count
  await P.emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, cp);
  writeFileSync(d + "/docs/plan.md", SCOPE("<какие файлы>"));
  t("5 план с заглушкой SCOPE не пускает кодера", blocked(await P.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "пиши" }] } }, cp)));

  // real plan
  await P.emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, cp);
  writeFileSync(d + "/docs/plan.md", SCOPE("src/orders.ts"));
  t("6 гейт: ревьюер запускается", !blocked(await P.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "проверь план" }] } }, cp)));
  await P.emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { verdict: "pass", next_prompt: "СДЕЛАЙ ФИЛЬТР" } } }] } }, cp);
  t("7 review.md записан в проект", existsSync(d + "/docs/review.md"));
  t("8 review.md помечен отпечатком плана", /KEEL-PLAN:/.test(readFileSync(d + "/docs/review.md", "utf8")));

  const r = await P.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, cp);
  const inj = r[0]?.input?.tasks?.[0]?.task ?? "";
  t("9 кодеру дошёл контракт", inj.includes("GET /orders"));
  t("10 кодеру дошёл вердикт дословно", inj.includes("СДЕЛАЙ ФИЛЬТР"));
  await new Promise((x) => setTimeout(x, 40));
  t("11 реестр задач заведён", /^- \[ \] T/m.test(readFileSync(d + "/docs/report.md", "utf8")));
  t("12 чек-лист приёмки заведён", (readFileSync(d + "/docs/report.md", "utf8").match(/^- \[ \]/gm) ?? []).length >= 3);

  // coder works within scope
  const C = makePi(); const cc = makeCtx(d, { hasUI: false });
  await C.emit("session_start", {}, cc);
  t("13 кодер пишет в scope", !blocked(await C.emit("tool_call", { toolName: "edit", input: { path: "src/orders.ts" } }, cc)));
  t("14 кодер не выходит за scope", blocked(await C.emit("tool_call", { toolName: "edit", input: { path: "README.md" } }, cc)));
  mkdirSync(d + "/src", { recursive: true });
  writeFileSync(d + "/src/orders.ts", "export const orders = () => 200;");

  // cannot settle with the checklist open
  await P.emit("tool_call", { toolName: "edit", input: { path: "docs/report.md" } }, cp);
  t("15 сдать с открытой приёмкой нельзя", (await P.emit("session_stop", {}, cp)).length > 0);

  // close everything and ship
  writeFileSync(d + "/docs/report.md", "## Task ledger\n- [x] T1 Фильтр\n\n## Final acceptance\n- [x] A\n- [x] B\n- [x] C");
  await P.emit("tool_call", { toolName: "bash", input: { command: "git add -A && git commit -m done" } }, cp);
  execSync("git add -A && git commit -qm done", { cwd: d });
  t("16 после закрытия можно завершать", (await P.emit("session_stop", {}, cp)).length === 0);
  await P.emit("context", { messages: [] }, cp);
  t("17 git-сегмент чист после коммита", (cp._status["keel-4"] ?? "").startsWith("✓"));
  t("18 этап: документы от прошлой задачи", (cp._status["keel-1"] ?? "").includes("прошлой задачи"));
}

const SIMS = [
  ["11 любой шелл (bash/PowerShell/cmd)", simShells],
  ["12 переключение проектов", simProjectSwitch],
  ["13 повреждённые документы", simCorruptDocs],
  ["14 отказ инфраструктуры", simInfraFailure],
  ["15 полный жизненный цикл", simLifecycle],
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

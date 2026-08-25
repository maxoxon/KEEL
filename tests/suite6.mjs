/** Типы задач: механика, а не текст. */
import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-suite6";
let n = 0;
function proj(contract) {
  const d = `${ROOT}/t${++n}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + "/docs", { recursive: true });
  execSync("git init -q && git config user.email a@b && git config user.name t", { cwd: d });
  writeFileSync(d + "/a.ts", "x");
  writeFileSync(d + "/.seed", "1");
  execSync("git add -A && git commit -qm i", { cwd: d });
  writeFileSync(d + "/docs/contract.md", contract);
  writeFileSync(d + "/docs/plan.md", "<!-- SCOPE -->\n- a.ts\n<!-- END SCOPE -->");
  // Реестр милей заполнен: иначе GUARD 17 отобьёт многомильные типы, и набор будет проверять его,
  // а не то, ради чего написан (правила типа, effort, статус). Гейт милей проверяется отдельно.
  writeFileSync(
    d + "/docs/report.md",
    "## Task ledger\n- [ ] T1 З - lane: standard\n\n## Current task\nMilestone ledger: M1 [ ] * M2 [ ]\n\n## Final acceptance\n- [ ] A",
  );
  return d;
}
const blocked = (r) => r.length > 0 && r[0]?.block === true;
const spawn = async (emit, c, agent = "coder") =>
  emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent, task: "делай" }] } }, c);

async function open_(contract) {
  const d = proj(contract);
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);
  await emit("context", { messages: [] }, c);
  return { d, emit, c };
}

async function simTypes(t) {
  // каждый тип: метка в статусе, правила впрыснуты, effort выставлен
  const expect = {
    "bug-fix": "hi", "small-feature": "med", "large-feature": "hi", refactor: "hi",
    "architecture-change": "hi", "new-project": "med", adopt: "med",
  };
  for (const [type, eff] of Object.entries(expect)) {
    const { emit, c } = await open_(`Тип: ${type}\n\n## Success criterion\n- ok`);
    const r = await spawn(emit, c);
    const item = r[0]?.input?.tasks?.[0];
    t(`${type}: тип виден в статусе`, (c._status["keel-1"] ?? "").includes(type));
    t(`${type}: правила типа впрыснуты`, (item?.task ?? "").includes("ТИП:"));
    t(`${type}: effort=${eff}`, item?.effort === eff);
  }
}

async function simAudit(t) {
  const { emit, c } = await open_("Тип: audit\n\n## Success criterion\n- отчёт по зонам");
  t("audit: кодер заблокирован", blocked(await spawn(emit, c, "coder")));
  const r = await spawn(emit, c, "coder");
  t("audit: причина объясняет, что это новая задача", /НОВАЯ задача/.test(r[0]?.reason ?? ""));
  t("audit: скаут разрешён", !blocked(await spawn(emit, c, "scout")));
  t("audit: ревьюер разрешён", !blocked(await spawn(emit, c, "reviewer")));
  t("audit: тип виден в статусе", (c._status["keel-1"] ?? "").includes("audit"));
}

async function simTypeRequired(t) {
  {
    const { emit, c } = await open_("## Success criterion\n- ok");
    const r = await spawn(emit, c);
    t("нет строки Тип: кодер отбит", blocked(r));
    t("в причине перечислены валидные типы", /bug-fix, small-feature/.test(r[0]?.reason ?? ""));
  }
  {
    const { emit, c } = await open_("Тип: почини-по-быстрому\n\n## Success criterion\n- ok");
    const r = await spawn(emit, c);
    t("неизвестный тип: кодер отбит", blocked(r));
    t("в причине назван нераспознанный тип", /не распознан/.test(r[0]?.reason ?? ""));
  }
  {
    const { emit, c } = await open_("Тип:   REFACTOR  \n\n## Success criterion\n- ok");
    t("регистр и пробелы не мешают", (c._status["keel-1"] ?? "").includes("refactor"));
  }
  {
    const { emit, c } = await open_("Type: audit\n\n## Success criterion\n- ok");
    t("английское Type тоже читается", (c._status["keel-1"] ?? "").includes("audit"));
  }
  {
    const { emit, c } = await open_("Тип: <bug-fix | refactor>\n\n## Success criterion\n- ok");
    t("заглушка шаблона типом не считается", !/bug-fix ·/.test(c._status["keel-1"] ?? ""));
  }
}

async function simTypeContent(t) {
  const cases = [
    ["bug-fix", /ОТЛАДЧИКОМ|debug/],
    ["refactor", /ДО и ПОСЛЕ/],
    ["architecture-change", /ТОЧКИ ОТКАТА/],
    ["large-feature", /импортов/],
    ["new-project", /MVP/],
    ["small-feature", /наименьший/],
    ["adopt", /точки входа/],
  ];
  for (const [type, re] of cases) {
    const { emit, c } = await open_(`Тип: ${type}\n\n## Success criterion\n- ok`);
    const r = await spawn(emit, c);
    t(`${type}: правило по существу дошло`, re.test(r[0]?.input?.tasks?.[0]?.task ?? ""));
  }
  // смена типа = смена механики
  const { d, emit, c } = await open_("Тип: small-feature\n\n## Success criterion\n- ok");
  writeFileSync(d + "/docs/contract.md", "Тип: audit\n\n## Success criterion\n- ok");
  t("сменил тип на audit — кодер сразу отбит", blocked(await spawn(emit, c)));
}

async function simMilestoneGate(t) {
  const withLedger = (led) =>
    `## Task ledger\n- [ ] T1 З - lane: large\n\n## Current task\n${led}\n\n## Final acceptance\n- [ ] A`;
  for (const [type, led, expectBlock] of [
    ["large-feature", "Milestone ledger: M1 [ ] * M2 [ ] * ...", true],
    ["large-feature", "Milestone ledger: M1 [ ] * M2 [ ] * M3 [ ]", false],
    ["architecture-change", "Milestone ledger: M1 [ ] * M2 [ ] * ...", true],
    ["new-project", "Milestone ledger: M1 [ ] * M2 [ ]", false],
    ["small-feature", "", false],
    ["bug-fix", "", false],
  ]) {
    const d = proj(`Тип: ${type}\n\n## Success criterion\n- ok`);
    writeFileSync(d + "/docs/report.md", withLedger(led));
    const { emit } = makePi();
    const c = makeCtx(d, { hasUI: true });
    await emit("session_start", {}, c);
    const r = await spawn(emit, c);
    t(`${type}${led.includes("...") ? " без милей" : led ? " с милями" : ""}: кодер ${expectBlock ? "отбит" : "запущен"}`,
      blocked(r) === expectBlock);
  }
}

const SIMS = [
  ["22 все типы: статус, правила, effort", simTypes],
  ["23 audit — только чтение", simAudit],
  ["24 тип обязателен и валидируется", simTypeRequired],
  ["25 содержание правил по типам", simTypeContent],
  ["26 многомильные типы требуют разбиения", simMilestoneGate],
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

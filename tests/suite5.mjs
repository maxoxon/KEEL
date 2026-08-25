/**
 * Две вещи, которые нельзя принять на веру:
 *  A. держится ли харнесс через 100+ ходов и несколько задач в одной сессии;
 *  B. что РЕАЛЬНО видит пользователь в точке остановки и после /clear.
 * Здесь оба вопроса проверяются настоящими вызовами хука, а вывод печатается как есть.
 */
import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-long";
const SCOPE = (...e) => "<!-- SCOPE -->\n" + e.map((x) => "- " + x).join("\n") + "\n<!-- END SCOPE -->";
const LEDGER = (n) =>
  `## Task ledger\n- [ ] T1 ${n} - lane: standard - status: coding\n\n## Final acceptance\n- [ ] Критерий прогнан живьём\n- [ ] Регрессия пройдена`;
const CLOSED = (n) => `## Task ledger\n- [x] T1 ${n}\n\n## Final acceptance\n- [x] Критерий прогнан живьём\n- [x] Регрессия пройдена`;
const blocked = (r) => r.length > 0 && r[0]?.block === true;

function proj(files) {
  const d = `${ROOT}/p${Date.now() % 100000}`;
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

// ---------------------------------------------------------------------------------------------
// A. ДОЛГАЯ СЕССИЯ: 8 задач, 120+ ходов, попытки обхода на каждом этапе.
// ---------------------------------------------------------------------------------------------
async function simLongHaul(t) {
  const files = { "README.md": "проект" };
  for (let i = 0; i < 10; i++) files[`mod${i}.ts`] = `код ${i}`;
  const d = proj(files);
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);

  let turns = 0;
  let fenceHeld = true;      // оркестратор ни разу не смог записать код
  let scopeHeld = true;      // кодер ни разу не вышел за scope
  let contractHeld = true;   // кодер ни разу не стартовал без контракта
  let phaseAlways = true;    // фаза впрыскивалась каждый ход
  const seenPhases = new Set();

  for (let task = 1; task <= 8; task++) {
    const mine = `mod${task}.ts`;
    const notMine = `mod${(task + 5) % 10}.ts`;

    // --- интейк: попытка сразу отдать кодеру (должна отбиваться каждый раз) ---
    writeFileSync(d + "/docs/contract.md", ""); // намеренно пусто: кодер обязан быть отбит
    if (!blocked(await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "погнали" }] } }, c))) contractHeld = false;
    turns++;

    // --- оркестратор пишет контракт и план ---
    await emit("tool_call", { toolName: "write", input: { path: "docs/contract.md" } }, c);
    writeFileSync(d + "/docs/contract.md", `Тип: small-feature\n\nК: задача ${task} работает на живых данных`);
    await emit("tool_call", { toolName: "write", input: { path: "docs/plan.md" } }, c);
    writeFileSync(d + "/docs/plan.md", SCOPE(mine));
    writeFileSync(d + "/docs/report.md", LEDGER(`Задача ${task}`));
    turns += 2;

    // --- фаза ДО гейта (должна быть 3/4) ---
    await emit("context", { messages: [] }, c);
    { const lbl = c._status["keel-1"] ?? ""; const m = lbl.match(/[1-4]\/4|свободный|прошлой/); if (m) seenPhases.add(m[0]); }
    turns++;

    // --- гейт ---
    await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "проверь план" }] } }, c);
    await emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { verdict: "pass", next_prompt: `ВЕРДИКТ-${task}` } } }] } }, c);
    turns += 2;

    // --- имплементация: кодер получает вердикт ДОСЛОВНО ---
    const r = await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
    if (!(r[0]?.input?.tasks?.[0]?.task ?? "").includes(`ВЕРДИКТ-${task}`)) contractHeld = false;
    await emit("tool_result", { toolName: "task", details: { results: [] } }, c);
    turns += 2;

    // --- кодер работает: своё можно, чужое нельзя ---
    const C = makePi(); const cc = makeCtx(d, { hasUI: false });
    await C.emit("session_start", {}, cc);
    for (let k = 0; k < 6; k++) {
      if (blocked(await C.emit("tool_call", { toolName: "edit", input: { path: mine } }, cc))) scopeHeld = false;
      if (!blocked(await C.emit("tool_call", { toolName: "edit", input: { path: notMine } }, cc))) scopeHeld = false;
      turns += 2;
    }

    // --- оркестратор регулярно пробует срезать угол (каждую задачу, разными способами) ---
    const dodges = [
      { toolName: "edit", input: { path: mine } },
      { toolName: "write", input: { path: mine } },
      { toolName: "bash", input: { command: `cat > ${mine} <<'EOF'\nx\nEOF` } },
      { toolName: "bash", input: { command: `cp README.md ${mine}` } },
      { toolName: "lsp", input: { action: "rename", file: mine, new_name: "z" } },
      { toolName: "bash", input: { command: `Set-Content -Path ${mine} -Value x` } },
    ];
    for (const dd of dodges) {
      if (!blocked(await emit("tool_call", dd, c))) fenceHeld = false;
      turns++;
    }

    // --- фаза впрыскивается каждый ход ---
    for (let k = 0; k < 3; k++) {
      const out = await emit("context", { messages: [] }, c);
      const txt = out[0]?.messages?.at(-1)?.content?.[0]?.text ?? "";
      if (!txt.includes("[KEEL]")) phaseAlways = false;
      const lbl = c._status["keel-1"] ?? "";
      { const m = lbl.match(/[1-4]\/4|свободный|прошлой/); if (m) seenPhases.add(m[0]); }
      turns++;
    }

    // --- закрытие ---
    writeFileSync(d + "/docs/report.md", CLOSED(`Задача ${task}`));
    await emit("tool_call", { toolName: "bash", input: { command: "git add -A && git commit -m done" } }, c);
    execSync("git add -A && git commit -qm done", { cwd: d });
    turns++;
  }

  t(`сессия прожила ${turns} ходов`, turns >= 100);
  t("код-фенс держался ВСЕ 8 задач (48 попыток обхода)", fenceHeld);
  t("scope-lock держался все задачи", scopeHeld);
  t("контракт и вердикт держались все задачи", contractHeld);
  t("фаза впрыскивалась на КАЖДОМ ходу", phaseAlways);
  t("этапы менялись, а не залипли", seenPhases.size >= 2);

  // последний штрих: после всего этого оркестратор всё ещё не может писать код
  t("после 100+ ходов фенс всё ещё стоит",
    blocked(await emit("tool_call", { toolName: "write", input: { path: "mod9.ts" } }, c)));
  t("после 100+ ходов кодер без контракта всё ещё не стартует",
    (writeFileSync(d + "/docs/contract.md", ""),
      blocked(await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, c))));
}

// ---------------------------------------------------------------------------------------------
// B. ЧТО ВИДИТ ПОЛЬЗОВАТЕЛЬ: точка остановки -> /clear -> продолжение.
// ---------------------------------------------------------------------------------------------
async function simUserView(t) {
  const d = proj({ "src/orders.ts": "код" });
  const { emit } = makePi();
  const c = makeCtx(d, { hasUI: true });
  await emit("session_start", {}, c);

  writeFileSync(d + "/docs/contract.md", "Тип: small-feature\n\nК: /orders отдаёт 200 на живых данных");
  writeFileSync(d + "/docs/plan.md", SCOPE("src/orders.ts"));
  writeFileSync(d + "/docs/report.md", LEDGER("Фильтр заказов"));
  await emit("context", { messages: [] }, c);
  const gateStatus = c._status["keel-1"];
  // гейт: ревьюер смотрит план (без этого фаза законно стоит на 3/4)
  await emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "проверь план" }] } }, c);
  await emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { verdict: "pass", next_prompt: "ДЕЛАЙ ФИЛЬТР" } } }] } }, c);
  await emit("context", { messages: [] }, c);
  const midStatus = c._status["keel-1"];

  // работа закончена, приёмка закрыта, задача ещё открыта
  writeFileSync(d + "/docs/report.md",
    "## Task ledger\n- [ ] T1 Фильтр заказов - lane: standard\n\n## Final acceptance\n- [x] Критерий прогнан живьём\n- [x] Регрессия пройдена");
  const out = await emit("context", { messages: [] }, c);
  const injected = out[0]?.messages?.at(-1)?.content?.[0]?.text ?? "";
  const closeStatus = c._status["keel-1"];

  t("до гейта статус зовёт на проверку плана", /3\/4/.test(gateStatus ?? ""));
  t("после гейта статус показывает работу", /4\/4/.test(midStatus ?? ""));
  t("в точке закрытия статус говорит, что делать", /закрой задачу/.test(closeStatus ?? ""));
  t("оркестратору впрыснута инструкция по закрытию", /Фаза: ЗАКРЫТИЕ/.test(injected));
  t("в инструкции есть предложение чистой сессии", /\/clear/.test(injected));

  // пользователь делает /clear -> НОВЫЙ процесс на тех же файлах
  writeFileSync(d + "/docs/report.md", CLOSED("Фильтр заказов"));
  execSync("git add -A && git commit -qm done", { cwd: d });
  const B = makePi(); const cb = makeCtx(d, { hasUI: true });
  await B.emit("session_start", {}, cb);
  const out2 = await B.emit("context", { messages: [] }, cb);
  const injected2 = out2[0]?.messages?.at(-1)?.content?.[0]?.text ?? "";

  t("после /clear харнесс сразу знает, где мы", /прошлой задачи/.test(cb._status["keel-1"] ?? ""));
  t("и говорит, что делать с новой задачей", /замени контракт и план/.test(injected2));
  t("git-сегмент чист", (cb._status["keel-4"] ?? "").startsWith("✓"));
  t("гарды в новой сессии работают с первого хода",
    blocked(await B.emit("tool_call", { toolName: "write", input: { path: "src/orders.ts" } }, cb)));

  // печатаем то, что реально увидит человек
  console.log("\n    ┌─ что видит пользователь ───────────────────────────────");
  console.log("    │ до гейта:   " + gateStatus);
  console.log("    │ в работе:   " + midStatus);
  console.log("    │ закрытие:   " + closeStatus);
  console.log("    │ после /clear: " + cb._status["keel-1"] + "   " + cb._status["keel-4"]);
  console.log("    └────────────────────────────────────────────────────────\n");
}

const SIMS = [
  ["20 долгая сессия: 8 задач, 100+ ходов", simLongHaul],
  ["21 глазами пользователя: остановка и /clear", simUserView],
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

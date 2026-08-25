/** 20 отладочных прогонов по углам, которых ещё не касались. Где поведение неочевидно - печатаем
 *  фактический результат, а не только вердикт. */
import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-debug20";
let n = 0;
const SC = (...e) => "<!-- SCOPE -->\n" + e.map((x) => "- " + x).join("\n") + "\n<!-- END SCOPE -->";
const LED = "## Task ledger\n- [ ] T1 З - lane: standard\n\n## Final acceptance\n- [ ] A";
const CT = "Тип: small-feature\n\n## Success criterion\n- ok";

function proj(files = {}) {
  const d = `${ROOT}/d${++n}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + "/docs", { recursive: true });
  mkdirSync(d + "/src", { recursive: true });
  execSync("git init -q && git config user.email a@b && git config user.name t", { cwd: d });
  writeFileSync(d + "/src/ok.ts", "x");
  writeFileSync(d + "/other.ts", "y");
  writeFileSync(d + "/.seed", "1");
  const base = { "docs/contract.md": CT, "docs/plan.md": SC("src/ok.ts"), "docs/report.md": LED };
  for (const [f, c] of Object.entries({ ...base, ...files })) {
    if (c === null) continue;
    const p = d + "/" + f;
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, c);
  }
  execSync("git add -A && git commit -qm i", { cwd: d });
  return d;
}
const blocked = (r) => r.length > 0 && r[0]?.block === true;
async function sub(d, agent = "coder") {
  const S = makePi();
  const c = makeCtx(d, { hasUI: false });
  c.getSystemPrompt = () => [`<!-- KEEL-AGENT: ${agent} -->`];
  await S.emit("session_start", {}, c);
  return { S, c, call: async (input, tool = "edit") => blocked(await S.emit("tool_call", { toolName: tool, input }, c)) };
}
async function prim(d) {
  const S = makePi();
  const c = makeCtx(d, { hasUI: true });
  await S.emit("session_start", {}, c);
  return { S, c };
}
const noThrow = async (fn) => { try { await fn(); return true; } catch { return false; } };

// ---------------------------------------------------------------------------------------------
async function run(t, say) {
  // 1. Файлы удалены посреди задачи
  {
    const d = proj();
    const { call } = await sub(d);
    rmSync(d + "/docs/plan.md");
    t("1 план удалён -> изменение отклонено (fail-closed)", await call({ path: "src/ok.ts" }));
    rmSync(d + "/docs/contract.md");
    const { S, c } = await prim(d);
    t("1b контракт удалён -> кодер не стартует",
      blocked(await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, c)));
  }
  // 2. docs/ - симлинк
  {
    const d = proj();
    const real = d + "_docs";
    rmSync(real, { recursive: true, force: true });
    mkdirSync(real, { recursive: true });
    writeFileSync(real + "/contract.md", CT);
    writeFileSync(real + "/plan.md", SC("src/ok.ts"));
    writeFileSync(real + "/report.md", LED);
    rmSync(d + "/docs", { recursive: true, force: true });
    try { symlinkSync(real, d + "/docs"); } catch { /* ok */ }
    const { call } = await sub(d);
    t("2 docs как симлинк читается", !(await call({ path: "src/ok.ts" })));
    t("2b и scope при этом действует", await call({ path: "other.ts" }));
  }
  // 3. SCOPE открыт, но пуст
  {
    const { call } = await sub(proj({ "docs/plan.md": "<!-- SCOPE -->\n<!-- END SCOPE -->" }));
    t("3 пустой SCOPE -> всё отклонено", await call({ path: "src/ok.ts" }));
  }
  // 4. Два блока SCOPE
  {
    const { call } = await sub(proj({ "docs/plan.md": SC("src/ok.ts") + "\n" + SC("other.ts") }));
    const a = await call({ path: "src/ok.ts" }), b = await call({ path: "other.ts" });
    say(`4 два блока SCOPE: первый=${a ? "блок" : "ок"} второй=${b ? "блок" : "ок"}`);
    t("4 два блока SCOPE не роняют хук", typeof a === "boolean" && typeof b === "boolean");
  }
  // 5. Контракт из одних пробелов
  {
    const { S, c } = await prim(proj({ "docs/contract.md": "   \n\n  \t \n" }));
    t("5 пустой контракт -> кодер не стартует",
      blocked(await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, c)));
  }
  // 6. Отчёт без реестра, только приёмка
  {
    const d = proj({ "docs/report.md": "## Final acceptance\n- [ ] A\n- [ ] B" });
    const { call } = await sub(d);
    say(`6 отчёт без реестра: правка в scope -> ${(await call({ path: "src/ok.ts" })) ? "блок" : "ок"}`);
    const { S, c } = await prim(d);
    await S.emit("tool_call", { toolName: "edit", input: { path: "docs/report.md" } }, c);
    t("6 без реестра приёмка всё равно держит сдачу", (await S.emit("session_stop", {}, c)).length > 0);
  }
  // 7. Строка реестра без пробела после T
  {
    const d = proj({ "docs/report.md": "## Task ledger\n- [ ]T1 З\n\n## Final acceptance\n- [ ] A" });
    const { call } = await sub(d);
    say(`7 реестр без пробела: правка -> ${(await call({ path: "src/ok.ts" })) ? "блок" : "ок"}`);
    t("7 не роняет хук", true);
  }
  // 8. Бинарный мусор в плане
  {
    const { call } = await sub(proj({ "docs/plan.md": SC("src/ok.ts") + "\n\u0000\u0001\uFFFD".repeat(500) }));
    t("8 бинарный мусор в плане: scope работает", !(await call({ path: "src/ok.ts" })) );
    t("8b и чужое блокируется", await call({ path: "other.ts" }));
  }
  // 9. plan.md - каталог
  {
    const d = proj({ "docs/plan.md": null });
    mkdirSync(d + "/docs/plan.md", { recursive: true });
    t("9 plan.md как каталог не роняет хук", await noThrow(async () => { const { call } = await sub(d); await call({ path: "src/ok.ts" }); }));
  }
  // 10. Тип с хвостовым комментарием
  {
    const { c } = await prim(proj({ "docs/contract.md": "Тип: refactor   # почему так\n\n## Success criterion\n- ok" }));
    say(`10 тип с комментарием -> статус: ${c._status["keel-1"]}`);
    t("10 тип с комментарием не роняет хук", typeof c._status["keel-1"] === "string");
  }
  // 11. Несколько строк Тип
  {
    const { c } = await prim(proj({ "docs/contract.md": "Тип: audit\nТип: small-feature\n\n## Success criterion\n- ok" }));
    say(`11 два типа -> статус: ${c._status["keel-1"]} (берётся первый)`);
    t("11 два типа: выбран один, детерминированно", (c._status["keel-1"] ?? "").includes("audit"));
  }
  // 12. Батч из 100 элементов
  {
    const { S, c } = await prim(proj());
    const tasks = Array.from({ length: 100 }, (_, i) => ({ agent: "scout", task: "з" + i }));
    const t0 = Date.now();
    const r = await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks } }, c);
    say(`12 батч 100 скаутов: ${Date.now() - t0}мс, ${blocked(r) ? "блок" : "разрешён"}`);
    t("12 большой батч обрабатывается быстро", Date.now() - t0 < 2000);
  }
  // 13. Элемент задачи с мусорным agent
  {
    const { S, c } = await prim(proj());
    t("13 agent как число/массив не роняет хук", await noThrow(async () => {
      await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: 42, task: "x" }, { agent: ["coder"], task: "y" }] } }, c);
    }));
  }
  // 14. toolName мусорный
  {
    const { S, c } = await prim(proj());
    t("14 toolName null/число не роняет хук", await noThrow(async () => {
      await S.emit("tool_call", { toolName: null, input: { path: "x" } }, c);
      await S.emit("tool_call", { toolName: 7, input: { path: "x" } }, c);
      await S.emit("tool_call", {}, c);
    }));
  }
  // 15. Битый tool_result
  {
    const { S, c } = await prim(proj());
    t("15 битый tool_result не роняет хук", await noThrow(async () => {
      await S.emit("tool_result", { toolName: "task", details: "строка вместо объекта" }, c);
      await S.emit("tool_result", { toolName: "task", details: { results: "не массив" } }, c);
      await S.emit("tool_result", { toolName: "task", details: { results: [null, 5, {}] } }, c);
    }));
  }
  // 16. session_stop дважды подряд
  {
    const d = proj();
    const { S, c } = await prim(d);
    await S.emit("tool_call", { toolName: "edit", input: { path: "docs/report.md" } }, c);
    const a = await S.emit("session_stop", {}, c);
    const b = await S.emit("session_stop", {}, c);
    const cc = await S.emit("session_stop", {}, c);
    say(`16 session_stop x3 -> ${[a, b, cc].map((x) => (x.length ? "возврат" : "пропуск")).join(", ")}`);
    t("16 пушбек ограничен, не зацикливает", cc.length === 0);
  }
  // 17. Огромный массив сообщений в context
  {
    const { S, c } = await prim(proj());
    const msgs = Array.from({ length: 5000 }, (_, i) => ({ role: "user", content: [{ type: "text", text: "m" + i }] }));
    const t0 = Date.now();
    const r = await S.emit("context", { messages: msgs }, c);
    say(`17 5000 сообщений в context: ${Date.now() - t0}мс, фаза ${r.length ? "впрыснута" : "нет"}`);
    t("17 большой контекст обрабатывается быстро", Date.now() - t0 < 1500);
  }
  // 18. git в detached HEAD
  {
    const d = proj();
    execSync("git checkout -q --detach HEAD", { cwd: d });
    const { c } = await prim(d);
    say(`18 detached HEAD -> git-сегмент: ${c._status["keel-4"] || "(пусто)"}`);
    t("18 detached HEAD не роняет статус", typeof c._status["keel-1"] === "string");
  }
  // 19. Путь с переводом строки и нулевым байтом
  {
    const { call } = await sub(proj());
    t("19 путь с \\n и \\0 не роняет хук", await noThrow(async () => {
      await call({ path: "src/ok.ts\nother.ts" });
      await call({ path: "src/\u0000ok.ts" });
    }));
  }
  // 20. Запись scope = "/" и windows-диск
  {
    const { call } = await sub(proj({ "docs/plan.md": SC("/", "C:\\Windows\\System32", "src/ok.ts") }));
    t("20 scope '/' не даёт доступ ко всему", await call({ path: "other.ts" }));
    t("20b легальная запись рядом с мусором работает", !(await call({ path: "src/ok.ts" })));
  }
}

const main = async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  let pass = 0, fail = 0;
  const fails = [], notes = [];
  const t = (d, ok) => { ok ? pass++ : (fail++, fails.push(d)); };
  const say = (m) => notes.push(m);
  try { await run(t, say); } catch (e) { fail++; fails.push("ИСКЛЮЧЕНИЕ: " + e.message + "\n" + (e.stack ?? "").split("\n")[1]); }
  console.log("наблюдения:");
  notes.forEach((x) => console.log("   · " + x));
  console.log(`\n  ИТОГО: ${pass} прошло, ${fail} провалено`);
  if (fails.length) { console.log("\n  ПРОВАЛЫ:"); fails.forEach((f) => console.log("   ✗ " + f)); }
  return fail;
};
process.exit(await main());

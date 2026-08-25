/** Второй заход: 20 других углов. Печатаем фактическое поведение там, где оно неочевидно. */
import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-debug40";
let n = 0;
const SC = (...e) => "<!-- SCOPE -->\n" + e.map((x) => "- " + x).join("\n") + "\n<!-- END SCOPE -->";
const LED = "## Task ledger\n- [ ] T1 З - lane: standard\n\n## Final acceptance\n- [ ] A";
const CT = "Тип: small-feature\n\n## Success criterion\n- ok";

function proj(files = {}) {
  const d = `${ROOT}/e${++n}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + "/docs", { recursive: true });
  mkdirSync(d + "/src", { recursive: true });
  execSync("git init -q && git config user.email a@b && git config user.name t", { cwd: d });
  writeFileSync(d + "/src/ok.ts", "x");
  writeFileSync(d + "/src/two.ts", "y");
  writeFileSync(d + "/secret.ts", "важное");
  writeFileSync(d + "/.seed", "1");
  for (const [f, c] of Object.entries({ "docs/contract.md": CT, "docs/plan.md": SC("src/ok.ts"), "docs/report.md": LED, ...files })) {
    if (c === null) continue;
    const p = d + "/" + f;
    mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    writeFileSync(p, c);
  }
  execSync("git add -A && git commit -qm i", { cwd: d });
  return d;
}
const blocked = (r) => r.length > 0 && r[0]?.block === true;
async function agent(d, who = "coder") {
  const S = makePi();
  const c = makeCtx(d, { hasUI: false });
  c.getSystemPrompt = () => [`<!-- KEEL-AGENT: ${who} -->`];
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

async function run(t, say) {
  // 21. КРИТИЧНО: может ли кодер переписать себе план и расширить scope
  {
    const d = proj();
    const { call } = await agent(d);
    const wrotePlan = !(await call({ path: "docs/plan.md" }));
    say(`21 кодер пишет docs/plan.md -> ${wrotePlan ? "ПРОШЛО" : "блок"}`);
    t("21 кодер НЕ может переписать план", !wrotePlan);
    t("21b кодер не может переписать контракт", await call({ path: "docs/contract.md" }));
    t("21c кодер не может переписать вердикт", await call({ path: "docs/review.md" }));
    t("21d но отчёт о работе писать может", !(await call({ path: "docs/PHASE_REPORT_x.md" })));
  }
  // 22. Ревьюер и скаут тоже не должны трогать план
  {
    const d = proj();
    t("22 ревьюер не пишет план", (await agent(d, "reviewer")).call({ path: "docs/plan.md" }).then((x) => x));
    const sc = await agent(d, "scout");
    t("22b скаут не пишет вообще ничего", await sc.call({ path: "docs/plan.md" }));
  }
  // 23. CRLF + BOM в контракте
  {
    const { c } = await prim(proj({ "docs/contract.md": "\uFEFFТип: refactor\r\n\r\n## Success criterion\r\n- ok\r\n" }));
    say(`23 BOM+CRLF в контракте -> ${c._status["keel-1"]}`);
    t("23 BOM и CRLF не мешают прочитать тип", (c._status["keel-1"] ?? "").includes("refactor"));
  }
  // 24. Глобы в scope
  {
    const { call } = await agent(proj({ "docs/plan.md": SC("src/*.ts") }));
    const a = !(await call({ path: "src/ok.ts" })), b = !(await call({ path: "secret.ts" }));
    say(`24 глоб src/*.ts: src/ok.ts=${a ? "ок" : "блок"}, secret.ts=${b ? "ок" : "блок"}`);
    t("24 глоб не открывает доступ наружу", !b);
  }
  // 25. Пробелы и дубли в записях scope
  {
    const { call } = await agent(proj({ "docs/plan.md": SC("  src/ok.ts  ", "src/ok.ts", "src/ok.ts") }));
    t("25 пробелы и дубли не мешают", !(await call({ path: "src/ok.ts" })));
    t("25b и не открывают лишнего", await call({ path: "secret.ts" }));
  }
  // 26. 500 записей в scope
  {
    const many = Array.from({ length: 500 }, (_, i) => `src/gen${i}.ts`);
    const d = proj({ "docs/plan.md": SC(...many, "src/ok.ts") });
    const { call } = await agent(d);
    const t0 = Date.now();
    const ok = !(await call({ path: "src/ok.ts" }));
    const no = await call({ path: "secret.ts" });
    say(`26 500 записей scope: ${Date.now() - t0}мс`);
    t("26 большой scope работает и быстро", ok && no && Date.now() - t0 < 1000);
  }
  // 27. next_prompt не строка
  {
    const d = proj();
    const { S, c } = await prim(d);
    t("27 next_prompt числом/объектом не роняет хук", await noThrow(async () => {
      for (const v of [42, { a: 1 }, ["x"], null, ""]) {
        await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "г" }] } }, c);
        await S.emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { next_prompt: v } } }] } }, c);
      }
    }));
  }
  // 28. Гигантский next_prompt
  {
    const d = proj();
    const { S, c } = await prim(d);
    await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "г" }] } }, c);
    const huge = "ВЕРДИКТ ".repeat(50000);
    await S.emit("tool_result", { toolName: "task", details: { results: [{ structuredOutput: { status: "valid", data: { next_prompt: huge } } }] } }, c);
    const t0 = Date.now();
    const r = await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "делай" }] } }, c);
    say(`28 вердикт 400КБ: ${Date.now() - t0}мс, впрыснут=${(r[0]?.input?.tasks?.[0]?.task ?? "").includes("ВЕРДИКТ")}`);
    t("28 гигантский вердикт не вешает хук", Date.now() - t0 < 1500);
  }
  // 29. Пустой батч и tasks не массив
  {
    const { S, c } = await prim(proj());
    t("29 пустой/битый tasks не роняет хук", await noThrow(async () => {
      await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [] } }, c);
      await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: "строка" } }, c);
      await S.emit("tool_call", { toolName: "task", input: null }, c);
    }));
  }
  // 30. Регистр слова Тип и омоглиф в значении
  {
    const a = await prim(proj({ "docs/contract.md": "тип: audit\n\n## Success criterion\n- ok" }));
    say(`30 строчное «тип:» -> ${a.c._status["keel-1"]}`);
    const b = await prim(proj({ "docs/contract.md": "Тип: \u0430udit\n\n## Success criterion\n- ok" })); // кириллическая а
    say(`30b омоглиф в значении -> ${b.c._status["keel-1"]}`);
    t("30 омоглиф не притворяется валидным типом", !(b.c._status["keel-1"] ?? "").includes("audit ·"));
    const r = await b.S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, b.c);
    t("30c и блокирует кодера как нераспознанный", blocked(r));
  }
  // 31. Репозиторий без коммитов
  {
    const d = `${ROOT}/nocommit`;
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d + "/docs", { recursive: true });
    execSync("git init -q", { cwd: d });
    writeFileSync(d + "/a.ts", "x");
    writeFileSync(d + "/docs/contract.md", CT);
    writeFileSync(d + "/docs/plan.md", SC("a.ts"));
    writeFileSync(d + "/docs/report.md", LED);
    const { c } = await prim(d);
    say(`31 репозиторий без коммитов -> git: ${c._status["keel-4"] || "(пусто)"}`);
    t("31 репозиторий без коммитов не роняет статус", typeof c._status["keel-1"] === "string");
  }
  // 32. Огромный отчёт
  {
    const big = LED + "\n" + "- [x] пункт\n".repeat(200000);
    const d = proj({ "docs/report.md": big });
    const t0 = Date.now();
    const { c } = await prim(d);
    say(`32 отчёт ~2.6МБ: ${Date.now() - t0}мс, фаза ${c._status["keel-1"]}`);
    t("32 огромный отчёт обрабатывается быстро", Date.now() - t0 < 3000);
  }
  // 33. Заглавные [X] в чек-боксах
  {
    const d = proj({ "docs/report.md": "## Task ledger\n- [X] T1 З\n\n## Final acceptance\n- [X] A" });
    const { c } = await prim(d);
    say(`33 заглавные [X] -> фаза: ${c._status["keel-1"]}`);
    t("33 заглавные [X] не роняют разбор", typeof c._status["keel-1"] === "string");
  }
  // 34. Маркеры SCOPE без пробелов и в другом регистре
  {
    const { call } = await agent(proj({ "docs/plan.md": "<!--scope-->\n- src/ok.ts\n<!--end scope-->" }));
    const ok = !(await call({ path: "src/ok.ts" })), no = await call({ path: "secret.ts" });
    say(`34 маркеры <!--scope--> без пробелов: в scope=${ok ? "ок" : "блок"}, вне=${no ? "блок" : "ок"}`);
    t("34 нестандартные маркеры не открывают лишнего", no);
  }
  // 35. audit + смешанный батч
  {
    const d = proj({ "docs/contract.md": "Тип: audit\n\n## Success criterion\n- отчёт" });
    const { S, c } = await prim(d);
    const r = await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "scout", task: "a" }, { agent: "coder", task: "b" }] } }, c);
    t("35 audit: смешанный батч с кодером отбит", blocked(r));
    const r2 = await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "scout", task: "a" }, { agent: "scout", task: "b" }] } }, c);
    t("35b audit: веер скаутов разрешён", !blocked(r2));
  }
  // 36. lsp code_actions с apply строкой
  {
    const { call } = await agent(proj());
    t("36 lsp code_actions apply=id заблокирован", await call({ action: "code_actions", apply: "fix-1", file: "src/ok.ts" }, "lsp"));
    t("36b lsp references разрешён", !(await call({ action: "references", file: "src/ok.ts" }, "lsp")));
  }
  // 37. bash: цепочка чтения и записи
  {
    const { call } = await agent(proj());
    t("37 `git status && echo x > secret.ts` заблокирован", await call({ command: "git status && echo x > secret.ts" }, "bash"));
    t("37b подстановка $(...) с записью заблокирована", await call({ command: "echo $(cat src/ok.ts) > secret.ts" }, "bash"));
    t("37c чистое чтение цепочкой разрешено", !(await call({ command: "git status && ls -la" }, "bash")));
  }
  // 38. Цель равна самому cwd
  {
    const d = proj();
    const { call } = await agent(d);
    t("38 путь = корень проекта заблокирован", await call({ path: "." }));
    // /tmp намеренно освобождён как черновой каталог (DISPOSABLE_PATH), а тестовые проекты лежат
    // именно там - поэтому проверяем на пути ВНЕ /tmp, где освобождения нет.
    t("38b абсолютный путь вне проекта заблокирован", await call({ path: "/etc/hosts" }));
  }
  // 39. Кодер пытается спавнить кодера
  {
    const { S, c } = await agent(proj());
    t("39 субагент не спавнит кодера",
      blocked(await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, c)));
    t("39b субагент спавнит скаута",
      !blocked(await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "scout", task: "x" }] } }, c)));
  }
  // 40. Порядок гардов: audit + нераспознанный тип одновременно
  {
    const d = proj({ "docs/contract.md": "Тип: аudit\n\n## Success criterion\n- ok" }); // омоглиф
    const { S, c } = await prim(d);
    const r = await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, c);
    say(`40 омоглиф-тип: причина = ${(r[0]?.reason ?? "").slice(0, 60)}`);
    t("40 сообщение объясняет проблему типа", /не распознан/.test(r[0]?.reason ?? ""));
  }
}

const main = async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  let pass = 0, fail = 0;
  const fails = [], notes = [];
  const t = (d, ok) => { ok ? pass++ : (fail++, fails.push(d)); };
  const say = (m) => notes.push(m);
  try { await run(t, say); } catch (e) { fail++; fails.push("ИСКЛЮЧЕНИЕ: " + e.message); }
  console.log("наблюдения:");
  notes.forEach((x) => console.log("   · " + x));
  console.log(`\n  ИТОГО: ${pass} прошло, ${fail} провалено`);
  if (fails.length) { console.log("\n  ПРОВАЛЫ:"); fails.forEach((f) => console.log("   ✗ " + f)); }
  return fail;
};
process.exit(await main());

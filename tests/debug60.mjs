/** Третий заход: 20 углов. Упор на детекцию записи в shell (её меняли последней) и на стыки гардов. */
import { makePi, makeCtx } from "./sim.mjs";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = "/tmp/keel-debug60";
let n = 0;
const SC = (...e) => "<!-- SCOPE -->\n" + e.map((x) => "- " + x).join("\n") + "\n<!-- END SCOPE -->";
const LED = "## Task ledger\n- [ ] T1 З - lane: standard\n\n## Final acceptance\n- [ ] A";
const CT = "Тип: small-feature\n\n## Success criterion\n- ok";

function proj(files = {}) {
  const d = `${ROOT}/f${++n}`;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + "/docs", { recursive: true });
  mkdirSync(d + "/src", { recursive: true });
  execSync("git init -q && git config user.email a@b && git config user.name t", { cwd: d });
  writeFileSync(d + "/src/ok.ts", "x");
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
  return { S, c, sh: async (command) => blocked(await S.emit("tool_call", { toolName: "bash", input: { command } }, c)),
           ed: async (path) => blocked(await S.emit("tool_call", { toolName: "edit", input: { path } }, c)) };
}
async function prim(d) {
  const S = makePi();
  const c = makeCtx(d, { hasUI: true });
  await S.emit("session_start", {}, c);
  return { S, c };
}

async function run(t, say) {
  const d = proj();
  const A = await agent(d);

  // 41-48: формы записи в shell, которые должны БЛОКИРОВАТЬСЯ (цель вне scope)
  t("41 heredoc в файл вне scope", await A.sh("cat <<EOF > secret.ts\nx\nEOF"));
  t("42 clobber >| вне scope", await A.sh("echo x >| secret.ts"));
  t("43 tee -a вне scope", await A.sh("echo x | tee -a secret.ts"));
  t("44 dd of= вне scope", await A.sh("dd if=/dev/zero of=secret.ts bs=1 count=1"));
  t("45 truncate вне scope", await A.sh("truncate -s 0 secret.ts"));
  t("46 префикс переменной окружения", await A.sh("FOO=1 cp src/ok.ts secret.ts"));
  t("47 два перенаправления, второе вне scope", await A.sh("echo x > src/ok.ts 2> secret.ts"));
  t("48 патч в файл вне scope", await A.sh("patch -p1 secret.ts < d.diff"));

  // 49-53: формы, которые должны ПРОХОДИТЬ (чтение или цель в scope)
  t("49 запись в scope через heredoc", !(await A.sh("cat <<EOF > src/ok.ts\nx\nEOF")));
  t("50 stderr в /dev/null не считается записью", !(await A.sh("npm test 2>/dev/null")));
  t("51 чтение с пайпом", !(await A.sh("cat secret.ts | grep foo")));
  t("52 сборка проекта", !(await A.sh("npm run build")));
  t("53 установка зависимостей", !(await A.sh("pip install requests")));

  // 54: несколько целей, одна вне scope
  t("54 `cp a src/ok.ts secret.ts` (последняя вне scope)", await A.sh("cp a src/ok.ts secret.ts"));

  // 55: scope, разрешающий сам план
  {
    const d2 = proj({ "docs/plan.md": SC("docs/plan.md", "src/ok.ts") });
    const B = await agent(d2);
    t("55 план в собственном scope не даёт кодеру его править", await B.ed("docs/plan.md"));
  }
  // 56: scope, разрешающий сам харнесс
  {
    const d3 = proj({ "docs/plan.md": SC("/root/.omp/agent/extensions/keel.ts", "src/ok.ts") });
    const C = await agent(d3);
    t("56 харнесс в scope всё равно не редактируется", await C.ed("/root/.omp/agent/extensions/keel.ts"));
  }
  // 57: симлинк plan.md наружу
  {
    const d4 = proj({ "docs/plan.md": null });
    const out = `${ROOT}/outside-plan.md`;
    writeFileSync(out, SC("secret.ts"));
    try { symlinkSync(out, d4 + "/docs/plan.md"); } catch { /* ok */ }
    const D = await agent(d4);
    const r = await D.ed("secret.ts");
    say(`57 план-симлинк наружу разрешает secret.ts -> ${r ? "блок" : "ПРОШЛО"}`);
    t("57 симлинк плана не роняет хук", typeof r === "boolean");
  }
  // 58: cwd меняется между вызовами
  {
    const d5 = proj();
    const d6 = proj();
    const S = makePi();
    const c5 = makeCtx(d5, { hasUI: false }); c5.getSystemPrompt = () => ["<!-- KEEL-AGENT: coder -->"];
    await S.emit("session_start", {}, c5);
    const c6 = makeCtx(d6, { hasUI: false }); c6.getSystemPrompt = () => ["<!-- KEEL-AGENT: coder -->"];
    const a = blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "secret.ts" } }, c5));
    const b = blocked(await S.emit("tool_call", { toolName: "edit", input: { path: "secret.ts" } }, c6));
    t("58 смена cwd не ломает scope", a && b);
  }
  // 59: ревьюер спавнит ревьюера, дизайнер спавнит кого угодно
  {
    const R = await agent(d, "reviewer");
    t("59 ревьюер не спавнит ревьюера",
      blocked(await R.S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "reviewer", task: "x" }] } }, R.c)));
    const G = await agent(d, "designer");
    t("59b дизайнер не спавнит кодера",
      blocked(await G.S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, G.c)));
  }
  // 60: Windows-путь в scope против POSIX-цели
  {
    const d7 = proj({ "docs/plan.md": SC("src\\ok.ts") });
    const E = await agent(d7);
    t("60 windows-запись scope совпадает с posix-целью", !(await E.ed("src/ok.ts")));
    t("60b и не открывает лишнего", await E.ed("secret.ts"));
  }
  // 61: контракт одной строкой без переводов
  {
    const { c } = await prim(proj({ "docs/contract.md": "Тип: refactor ## Success criterion - ok" }));
    say(`61 контракт одной строкой -> ${c._status["keel-1"]}`);
    t("61 не роняет разбор", typeof c._status["keel-1"] === "string");
  }
  // 62: тип внутри блока кода
  {
    const { S, c } = await prim(proj({ "docs/contract.md": "```\nТип: audit\n```\n\n## Success criterion\n- ok" }));
    const r = await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "x" }] } }, c);
    say(`62 тип в блоке кода -> статус ${c._status["keel-1"]}, кодер ${blocked(r) ? "блок" : "ок"}`);
    t("62 тип в блоке кода не роняет хук", typeof c._status["keel-1"] === "string");
  }
  // 63: юникод-нормализация имени файла
  {
    const nfc = "src/caf\u00e9.ts";       // é одним кодом
    const nfd = "src/cafe\u0301.ts";      // e + комбинирующий акут
    const d8 = proj({ "docs/plan.md": SC(nfc) });
    writeFileSync(d8 + "/" + nfc, "x");
    const F = await agent(d8);
    const a = !(await F.ed(nfc)), b = !(await F.ed(nfd));
    say(`63 NFC/NFD: NFC=${a ? "ок" : "блок"} NFD=${b ? "ок" : "блок"}`);
    t("63 разные нормализации не открывают чужое", await F.ed("secret.ts"));
  }
  // 64: turn_end очищает состояние спавна
  {
    const { S, c } = await prim(proj());
    await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "1" }] } }, c);
    await S.emit("turn_end", {}, c);
    const r = await S.emit("tool_call", { toolName: "task", input: { context: "c", tasks: [{ agent: "coder", task: "2" }] } }, c);
    t("64 turn_end снимает блокировку второго кодера", !blocked(r));
  }
  // 66-70: инлайн-запись из интерпретаторов и прочие формы
  t("66 node appendFileSync вне scope", await A.sh("node -e \"require('fs').appendFileSync('secret.ts','x')\""));
  t("67 python shutil.copy вне scope", await A.sh("python3 -c \"import shutil; shutil.copy('a','secret.ts')\""));
  t("68 Deno.writeTextFile вне scope", await A.sh("deno eval \"Deno.writeTextFile('secret.ts','x')\""));
  t("69 xargs с копированием вне scope", await A.sh("ls | xargs -I{} cp {} secret.ts"));
  t("70 чистый python-скрипт разрешён", !(await A.sh("python3 -c \"print(1)\"")));

  // 71-76: кавычки - это данные, а не синтаксис (регрессия, внесённая при отладке)
  t("71 grep по строке со стрелкой", !(await A.sh('grep -- "-->" src/ok.ts')));
  t("72 echo с html-комментарием", !(await A.sh('echo "<!-- SCOPE -->"')));
  t("73 git log с > в формате", !(await A.sh('git log --pretty=format:"%h>%s"')));
  t("74 jq с > в выражении", !(await A.sh('jq ".a>1" f.json')));
  t("75 стрелка в тексте не редирект", !(await A.sh('echo "a->b"')));
  t("76 но настоящий редирект всё ещё ловится", await A.sh("echo x > secret.ts"));

  // 65: git apply / stash pop
  {
    t("65 git apply вне scope заблокирован", await A.sh("git apply patch.diff"));
    t("65b git stash pop заблокирован", await A.sh("git stash pop"));
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
  if (notes.length) { console.log("наблюдения:"); notes.forEach((x) => console.log("   · " + x)); console.log(); }
  console.log(`  ИТОГО: ${pass} прошло, ${fail} провалено`);
  if (fails.length) { console.log("\n  ПРОВАЛЫ:"); fails.forEach((f) => console.log("   ✗ " + f)); }
  return fail;
};
process.exit(await main());

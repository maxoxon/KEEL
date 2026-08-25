#!/usr/bin/env python3
"""Строгий аудит РЕАЛЬНОГО установленного дерева. Ничего не имитирует: читает те самые файлы,
которые получит omp, парсит их настоящими парсерами и проверяет, что каждая ссылка разрешается."""
import json, os, re, sys, subprocess
import yaml

OMP = sys.argv[1] if len(sys.argv) > 1 else "/tmp/real/agent"
SRC = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/keel-fix"
issues, notes = [], []
def bad(m): issues.append(m)
def note(m): notes.append(m)

def read(p):
    with open(p, "rb") as f: raw = f.read()
    return raw

# --- 1. Целостность файлов -------------------------------------------------------------------
for root, _, files in os.walk(OMP):
    for fn in files:
        p = os.path.join(root, fn)
        raw = read(p)
        rel = os.path.relpath(p, OMP)
        if raw.startswith(b"\xef\xbb\xbf"): bad(f"{rel}: BOM в начале файла")
        try: raw.decode("utf-8")
        except UnicodeDecodeError: bad(f"{rel}: не UTF-8")
        if raw and not raw.endswith(b"\n"): note(f"{rel}: нет перевода строки в конце")
        if b"\r\n" in raw: note(f"{rel}: CRLF внутри установленного файла")
        # keel.ts содержит эту строку как ДЕТЕКТОР незаполненного конфига - это не плейсхолдер
        if b"KEEL_SETUP_REQUIRED" in raw and rel not in ("config.yml", "agents/coder.md", "extensions/keel.ts"):
            bad(f"{rel}: плейсхолдер модели там, где его быть не должно")

# --- 2. config.yml ---------------------------------------------------------------------------
cfg_raw = read(os.path.join(OMP, "config.yml")).decode()
try:
    cfg = yaml.safe_load(cfg_raw)
except Exception as e:
    cfg = {}; bad(f"config.yml не парсится: {e}")
# дубли ключей верхнего уровня YAML тихо перетирают друг друга
top = re.findall(r"^([A-Za-z_][\w]*):", cfg_raw, re.M)
dupes = {k for k in top if top.count(k) > 1}
if dupes: bad(f"config.yml: дублирующиеся ключи верхнего уровня {sorted(dupes)}")

roles = cfg.get("modelRoles") or {}
for r, v in roles.items():
    if isinstance(v, str) and v.strip() == "": bad(f"config.yml: роль {r} пустая")
need_true = [("astGrep", "enabled"), ("task", "enableLsp"), ("task", "enableEffort")]
for a, b in need_true:
    if (cfg.get(a) or {}).get(b) is not True: bad(f"config.yml: {a}.{b} должен быть true")
if (cfg.get("tools") or {}).get("approvalMode") != "yolo": bad("config.yml: approvalMode должен быть yolo")
if "eval" not in ((cfg.get("tools") or {}).get("approval") or {}): bad("config.yml: нет политики tools.approval.eval")
if not cfg.get("disabledProviders"): bad("config.yml: нет disabledProviders (изоляция от чужих агентов)")
if "task" in cfg and "maxEffort" in (cfg.get("task") or {}):
    bad("config.yml: task.maxEffort задан - это единственный путь к RangeError в resolveTaskEffortLevel")

# bash.patterns: порядок важен (first match wins), catch-all обязан быть последним
pats = (cfg.get("bash") or {}).get("patterns") or []
if pats:
    if pats[-1].get("match") != "*": bad("config.yml: bash.patterns - catch-all '*' не последний")
    if any(p.get("match") == "*" for p in pats[:-1]): bad("config.yml: bash.patterns - '*' встречается раньше конца")
    for p in pats:
        if p.get("approval") not in ("allow", "deny", "prompt"):
            bad(f"config.yml: bash.patterns - недопустимое approval {p.get('approval')!r}")

# --- 3. mcp.json -----------------------------------------------------------------------------
try:
    mcp = json.loads(read(os.path.join(OMP, "mcp.json")).decode())
    if "mcpServers" not in mcp: bad("mcp.json: нет ключа mcpServers")
    for name, srv in (mcp.get("mcpServers") or {}).items():
        if "command" not in srv: bad(f"mcp.json: сервер {name} без command")
except Exception as e:
    bad(f"mcp.json не парсится: {e}")

# --- 4. Агенты -------------------------------------------------------------------------------
AGENT_KEYS = {"name","description","tools","spawns","model","thinking-level","blocking","output",
              "autoloadSkills","read-summarize","prewalk","advisor"}
READ_ONLY_OMP = {"read","grep","glob","web_search","ast_grep","yield","hub","ask","todo","recall",
                 "reflect","retain","memory_edit","inspect_image","checkpoint","rewind"}
skills_dir = os.path.join(OMP, "skills")
have_skills = {d for d in os.listdir(skills_dir)} if os.path.isdir(skills_dir) else set()
agents = {}
adir = os.path.join(OMP, "agents")
for fn in sorted(os.listdir(adir)):
    if not fn.endswith(".md"): continue
    txt = read(os.path.join(adir, fn)).decode()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", txt, re.S)
    if not m: bad(f"agents/{fn}: нет frontmatter"); continue
    fm_raw, body = m.group(1), m.group(2)
    try: fm = yaml.safe_load(fm_raw)
    except Exception as e: bad(f"agents/{fn}: frontmatter не парсится: {e}"); continue
    name = fm.get("name"); agents[name] = fm
    if name != fn[:-3]: bad(f"agents/{fn}: name={name!r} не совпадает с именем файла")
    if not fm.get("description"): bad(f"agents/{fn}: нет description")
    unknown = set(fm) - AGENT_KEYS
    if unknown: bad(f"agents/{fn}: неизвестные ключи frontmatter {sorted(unknown)}")
    # дубли ключей внутри frontmatter
    keys = re.findall(r"^([A-Za-z_-][\w-]*):", fm_raw, re.M)
    d2 = {k for k in keys if keys.count(k) > 1}
    if d2: bad(f"agents/{fn}: дублирующиеся ключи frontmatter {sorted(d2)}")
    if "KEEL-AGENT:" not in body: bad(f"agents/{fn}: нет маркера KEEL-AGENT (GUARD 13 не узнает агента)")
    else:
        marker = re.search(r"KEEL-AGENT:\s*([a-z_-]+)", body).group(1)
        if marker != name: bad(f"agents/{fn}: маркер {marker!r} != name {name!r}")
    for s in (fm.get("autoloadSkills") or []):
        if s not in have_skills: bad(f"agents/{fn}: autoloadSkills -> {s} нет на диске")
    tools = [t.strip() for t in str(fm.get("tools","")).split(",") if t.strip()]
    if not tools: bad(f"agents/{fn}: пустой tools")
    # output-схема должна быть словарём с properties
    out = fm.get("output")
    if out is not None and not isinstance(out, dict): bad(f"agents/{fn}: output не объект")

# семантические ожидания харнесса
def has(a, t): return t in [x.strip() for x in str(agents.get(a,{}).get("tools","")).split(",")]
for a in ("scout","designer","planner","reviewer"):
    for w in ("edit","write","bash","eval","ast_edit"):
        if has(a, w): bad(f"{a}: имеет пишущий инструмент {w}")
if not has("coder","write"): bad("coder: нет write")
if not has("coder","debug"): bad("coder: нет debug (bug-fix требует отладчик)")
for a in ("coder","planner","reviewer"):
    if agents.get(a,{}).get("blocking") is not True: bad(f"{a}: blocking должен быть true (async.enabled=true по умолчанию)")
for a in ("scout","reviewer"):
    if agents.get(a,{}).get("read-summarize") is not False: bad(f"{a}: read-summarize должен быть false")
for a in ("coder","planner","reviewer"):
    if agents.get(a,{}).get("spawns") != "scout": bad(f"{a}: spawns должен быть scout")
for a in ("designer","scout"):
    if agents.get(a,{}).get("spawns"): bad(f"{a}: не должен иметь spawns")

# --- 5. Скилы --------------------------------------------------------------------------------
for d in sorted(have_skills):
    p = os.path.join(skills_dir, d, "SKILL.md")
    if not os.path.isfile(p): bad(f"skills/{d}: нет SKILL.md"); continue
    txt = read(p).decode()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", txt, re.S)
    if not m: bad(f"skills/{d}: нет frontmatter"); continue
    fm = yaml.safe_load(m.group(1))
    if fm.get("name") != d: bad(f"skills/{d}: name={fm.get('name')!r} != имени папки")
    if not fm.get("description"): bad(f"skills/{d}: нет description")
    if len(m.group(2).strip()) < 200: bad(f"skills/{d}: тело подозрительно короткое")
    if os.path.isdir(os.path.join(skills_dir, d)):
        nested = [x for x in os.listdir(os.path.join(skills_dir, d)) if os.path.isdir(os.path.join(skills_dir, d, x))]
        if nested: bad(f"skills/{d}: вложенные папки {nested} - omp их не обнаруживает")

# --- 6. Инструкции ---------------------------------------------------------------------------
for f in ("AGENTS.md","APPEND_SYSTEM.md","RULES.md"):
    p = os.path.join(OMP, f)
    if not os.path.isfile(p): bad(f"{f}: отсутствует"); continue
    if len(read(p)) < 500: bad(f"{f}: подозрительно мал")
append = read(os.path.join(OMP,"APPEND_SYSTEM.md")).decode()
for s in have_skills:
    pass
# ссылки skill:// должны существовать
for ref in set(re.findall(r"skill://([a-z-]+)", append)):
    if ref not in have_skills: bad(f"APPEND_SYSTEM.md: ссылка skill://{ref} не существует")

# --- 7. keel.ts ------------------------------------------------------------------------------
keel = read(os.path.join(OMP,"extensions","keel.ts")).decode()
guards = sorted({int(x) for x in re.findall(r"GUARD (\d+)", keel)})
if guards != list(range(1, len(guards)+1)): bad(f"keel.ts: номера гардов не подряд: {guards}")
declared = re.findall(r"^ \*\s+(\d+)\. ", keel, re.M)
if len(declared) != len(guards): bad(f"keel.ts: в заголовке {len(declared)} гардов, в коде {len(guards)}")
if "export default function hook" not in keel: bad("keel.ts: нет default-экспорта фабрики хука")
# каждое имя типа задачи должно быть перечислено в шаблоне контракта
types = set(re.findall(r'^\s{2}"?([a-z-]+)"?:\s*\{\s*$', keel, re.M))
tpl = read(os.path.join(SRC,"docs-templates","contract.md")).decode()
type_line = re.search(r"^Тип:\s*(.+)$", tpl, re.M)
if not type_line: bad("docs-templates/contract.md: нет строки Тип:")
else:
    listed = set(re.findall(r"[a-z-]+", type_line.group(1)))
    real_types = set(re.findall(r'\n  "?([a-z-]+)"?: \{\n    label:', keel))
    missing = real_types - listed
    if missing: bad(f"contract.md: в подсказке не перечислены типы {sorted(missing)}")

# --- Итог ------------------------------------------------------------------------------------
print(f"агентов: {len(agents)}   скилов: {len(have_skills)}   гардов: {len(guards)}")
print()
if issues:
    print(f"ПРОБЛЕМЫ ({len(issues)}):")
    for i in issues: print("  ✗", i)
else:
    print("ПРОБЛЕМ НЕ НАЙДЕНО")
if notes:
    print(f"\nзамечания ({len(notes)}):")
    for i in notes[:12]: print("  ·", i)
sys.exit(1 if issues else 0)

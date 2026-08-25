#!/usr/bin/env bash
# Сверка КАЖДОЙ механики KEEL с официальной документацией omp.
# Источник истины - каталог docs/ клона omp, а не память и не контекст.
# Запуск: ./tests/doc-conformance.sh /path/to/oh-my-pi
set -uo pipefail
OMP_SRC="${1:-/home/claude/omp-src}"
D="$OMP_SRC/docs"
S="$OMP_SRC/packages/coding-agent/src"
[ -d "$D" ] || { echo "не найден каталог docs: $D"; exit 2; }

ok=0; bad=0
chk() { # chk "механика" "файл" "паттерн"
  if grep -rqE "$3" "$2" 2>/dev/null; then printf "  ✓ %-46s %s\n" "$1" "${2##*/}"; ok=$((ok+1))
  else printf "  ✗ %-46s НЕ НАЙДЕНО в %s\n" "$1" "${2##*/}"; bad=$((bad+1)); fi
}

echo "== События хуков =="
chk "session_start"                    "$D/hooks.md"      'session_start'
chk "tool_call → {block,reason,input}" "$D/hooks.md"      'tool_call.*block.*reason.*input'
chk "tool_result → {content,details}"  "$D/hooks.md"      'tool_result.*content.*details'
chk "context → {messages}"             "$D/hooks.md"      'context. → can return .\{ messages'
chk "session_stop → {continue,...}"    "$D/extensions.md" 'session_stop.*continue: true, additionalContext'
chk "turn_end"                         "$D/hooks.md"      'turn_end'

echo "== Контракт хуков =="
chk "tool_call fail-closed при таймауте" "$S/extensibility/extensions/runner.ts" 'fail-closed'
chk "ui.confirm ставит таймер на паузу"  "$S/extensibility/extensions/runner.ts" 'timeoutBudget\?\.pause'
chk "session_stop не для субагентов"     "$D/extensions.md" 'never fires for task/subagent'
chk "первый block побеждает"             "$S/extensibility/extensions/runner.ts" 'if \(result\.block\)'

echo "== Поля ctx =="
chk "hasUI / cwd / sessionManager"     "$D/hooks.md"      'ctx. includes .hasUI'
chk "getSystemPrompt()"                "$D/extensions.md" 'getSystemPrompt'
chk "ui.confirm"                       "$D/hooks.md"      'ctx\.ui\.confirm'
chk "ui.setStatus (по ключам, сортировка)" "$D/hooks.md"  'setStatus\(key, text\)'
chk "pi.sendMessage"                   "$D/hooks.md"      'pi\.sendMessage'
chk "deliverAs nextTurn"               "$D/extensions.md" 'nextTurn'

echo "== Агенты =="
chk "frontmatter: tools/spawns/model/output" "$D/task-agent-discovery.md" 'optional .tools.*spawns.*model'
chk "blocking: родитель ждёт"          "$D/task-agent-discovery.md" 'blocking'
chk "autoloadSkills"                   "$D/task-agent-discovery.md" 'autoloadSkills'
chk "read-summarize → readSummarize"   "$D/task-agent-discovery.md" 'read-summarize: false. \(normalized'
chk "kebab→camel нормализация"         "$OMP_SRC/packages/utils/src/frontmatter.ts" 'thinking-level.* -> .thinkingLevel'
chk "AGENTS.md фильтруется у субагентов" "$S/task/structured-subagent.ts" 'agents\.md'
chk "read-only = список tools"         "$S/task/read-only-policy.ts" 'READ_ONLY_TOOL_NAMES'

echo "== Задачи и effort =="
chk "батч { context, tasks[] }"        "$S/config/settings-schema.ts" 'batch shape.*context, tasks'
chk "async.enabled по умолчанию true"  "$S/config/settings-schema.ts" 'async\.enabled'
chk "effort lo/med/hi + maxEffort"     "$D/task-agent-discovery.md" 'effort. \(.lo., .med., .hi.\)'
chk "модель без effort → откат"        "$D/task-agent-discovery.md" 'controllable effort surface'

echo "== Скилы =="
chk "путь <skills-root>/<имя>/SKILL.md" "$D/skills.md" 'skills-root./.skill-name./SKILL\.md'
chk "вложенность не обнаруживается"     "$D/skills.md" 'Nested patterns'
chk "метаданные в системном промпте"    "$D/skills.md" 'lightweight metadata in the system prompt'
chk "native приоритет 100"              "$D/skills.md" 'native. \(priority 100\)'
chk "дедуп по имени, первый выигрывает" "$D/skills.md" 'Dedup key is skill name'

echo "== Файлы и конфиг =="
chk "~/.omp/agent/AGENTS.md"           "$D/context-files.md" '~/\.omp/agent/AGENTS\.md'
chk "APPEND_SYSTEM.md = append-флаг"   "$D/system-prompt-customization.md" 'APPEND_SYSTEM\.md'
chk "RULES.md = sticky always-apply"   "$D/context-files.md" 'Sticky rules'
chk "disabledProviders"                "$D/context-files.md" 'disabledProviders'
chk "bash.patterns: deny абсолютен"    "$D/approval-mode.md" 'deny. is absolute'
chk "bash.patterns не покрывают eval"  "$D/approval-mode.md" 'tools\.approval\.eval'
chk "порядок конфигов и deep-merge"    "$D/config-usage.md" 'defaults'
chk "креды в agent.db, не в config"    "$D/auth-broker-gateway.md" 'agent\.db'
chk "слэш-команды commands/*.md"       "$D/config-usage.md" 'commands/\*\.md'
chk "/handoff в новую сессию"          "$D/handoff-generation-pipeline.md" 'handoff'

echo
echo "  сверено: $ok   расхождений: $bad"
exit $([ "$bad" -eq 0 ] && echo 0 || echo 1)

# Doneness-contract - <feature>

> Один контракт на одну задачу. Начинается новая - этот файл ПЕРЕЗАПИСЫВАЕТСЯ целиком; старый
> контракт не должен определять готовность новой работы.

Тип: <bug-fix | small-feature | large-feature | refactor | architecture-change | new-project | audit | adopt>

> Тип задаётся на приёме и определяет МЕХАНИКУ, а не только слова: сколько подтверждений возьмёт
> харнесс, какие правила прилетят кодеру, поднимется ли уровень мышления, потребуют ли отладчик.
> Он виден в статус-строке. Не угадывай - если сомневаешься между двумя, бери более тяжёлый.

Fixed BEFORE any code. "Done" means every field below is satisfied by REAL evidence, not a mock.

## Frontend
- Leads to: <where the control goes>
- Shows: <what renders, with real data>
- States: empty = <...>, error = <...>, loading = <...>

## Backend
- Endpoint: <METHOD /path>
- Returns: <shape>, from REAL data (not a mock)

## Wiring
- <front> actually calls <back> and renders the response, end to end

## Success criterion (the live check that proves it)
- <e.g. click -> GET /orders fires -> table renders the real rows from the DB>

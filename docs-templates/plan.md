# Plan - <task>

Lane: <trivial | standard | large/architectural>

## Milestones (atomic, ordered)
- [ ] M1 <objective> - verify: <the one check>
- [ ] M2 <objective> - verify: <the one check>

## Scope - the ONLY things this task may touch
> SCOPE действует, только пока в `docs/report.md` есть открытая задача. Если открытых нет, этот
> блок остался от прошлой работы и силы не имеет - начиная новую задачу, замени план и контракт.
Everything not listed here is off limits, including things that already exist. Enforced by the
extension: a change aimed at anything outside this list is blocked. Name files, paths, actors,
assets - whatever the target system uses.

Примеры того, как выглядят настоящие записи: `src/orders/Filter.tsx`, `api/routes/orders.py`,
`House_B` (актор сцены), `assets/ui/table.png`. Записи в угловых скобках считаются незаполненными
и отбрасываются - пока в блоке нет ни одной настоящей, харнесс не даст изменить ничего и прямо
скажет, что SCOPE не заполнен.

<!-- SCOPE -->
- <что именно эта задача вправе трогать - по одной записи на строку>
<!-- END SCOPE -->

## Affected files
- <path> -> <what changes, one line>

## Contract
See contract.md - every field must be fillable, or a gap is flagged (intent -> interrogate, fact -> scout).

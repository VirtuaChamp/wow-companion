# wow-companion-v1 / 10 — addon settings panel and report box

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D9, D10; `## UX / flow` Settings bullet; AC 16 (`settings.panel`), AC 20.

## Lane key
wow-companion-v1-10-addon-panels

## Depends on
02, 03. Uses `ns.Transport` (13) through the stub.

## Shared files
Fills `addon/WoWCompanion/{Settings,Report}.lua`, `tests/lua/stubs/panels.lua`, `tests/lua/globals/panels.lua`, `docs/client-facts.md` section "Settings and report".

## Scope
Owned: the two Lua files above, `tests/lua/{settings_panel,report_box}_test.lua`. Also `tests/lua/stubs/panels.lua` and `tests/lua/globals/panels.lua`.

## Code shape
- `ns.Settings.open()`, `ns.Settings.onOptions(msg)` (fills dropdowns from `{t:"options"}`), change → `ns.Transport.send({t:"settings", …})`. Before the first `options`: "Companion offline", dropdowns disabled; effort disabled when `efforts` is empty; uninstalled/disabled providers disabled with `reason` tooltip.
- `ns.Report.open()` — Blizzard dialog with a read-only scrollable editbox: new-issue URL of the repo, client build, addon version, companion version, provider/model/effort. No character name, realm or account path.

## Tests first
- `settings.panel` — parent AC 16 bullet — AC 16
- `report.box` — parent AC 20 — AC 20

## Must not change
- Parent `## Must not change`; Blizzard templates only (D10).

## Must refuse
- Model not listed / unsupported effort: never offered by the dropdown; the companion's `error` is printed if sent anyway (parent Must refuse, AC 17).

## The point everything turns on
The Settings API names on the `forever` branch. Check against: `Settings.RegisterVerticalLayoutCategory` and friends cited by path:line.

## Acceptance Criteria
1. `[file]` Parent AC 16, `settings.panel`. Fixture: `tests/lua/wow_stubs.lua`
2. `[file]` Parent AC 20. Fixture: as 1
3. `[file]` Parent AC 6, Settings part: the Settings API names with source. Fixture: wow-ui-source `forever` clone

## Open questions
none

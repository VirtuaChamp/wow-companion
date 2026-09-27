# wow-companion-v1 / 05 — QuestieDB → SQLite build

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D3, `## Data model`.

## Lane key
wow-companion-v1-05-build-db

## Depends on
01, 02 (Lua 5.1.5 runs the Questie tables)

## Shared files
none

## Scope
Owned: `scripts/build-db.ts`, `scripts/build-db/*.lua` (the Lua-side exporter), `tests/build-db/**` (3-row fixtures per Questie table + `areaIdToUiMapId` fixture), `scripts/db-schema.sql` (the parent's `## Data model` tables; slice 12 reads it to build `mini.sqlite`).

## Code shape
```
build-db <questie checkout path> [--out data/questie.sqlite]
  → run exporter.lua under .tools/lua51 over data/Forever/*.lua : JSON rows | Lua error (exit 1, file named)
  → resolve ui_map_id via support/Forever/Zones/areaIdToUiMapId.lua : number | null (row kept, null counted)
  → write SQLite per scripts/db-schema.sql in one transaction : void
```
Never parses Lua by regex (parent Data model).

## Tests first
- `builddb.smoke` — parent Tests first — AC 13

## Must not change
- `data/` never tracked; no Questie file copied into the repo (fixtures are hand-written 3-row tables, not excerpts).

## Must refuse
- Missing or wrong checkout path → exit 1 naming the expected `data/Forever/` folder, no partial `.sqlite` left.

## The point everything turns on
The export runs the real Lua tables. Check against: `builddb.smoke` feeds Lua fixtures through the same exporter the real build uses.

## Acceptance Criteria
1. `[file]` Parent AC 13, builddb part: `builddb.smoke` passes, `ui_map_id` resolved. Fixture: `tests/build-db/`
2. `[file]` `scripts/db-schema.sql` defines exactly the parent's `## Data model` tables and columns. Fixture: none

## Open questions
none

# wow-companion-v1 / 12 — MCP server and gear compare

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D3, D7, D14; Local API paragraph; MCP tools; `## Code shape` gear path.

## Lane key
wow-companion-v1-12-mcp-server

## Depends on
03, 05 (`scripts/db-schema.sql`)

## Shared files
none

## Scope
Owned: `apps/mcp/src/{server,db,local-api,tools,gear}.ts`, `apps/mcp/test/**` (incl. `fixtures/mini.sqlite` built from `scripts/db-schema.sql` by a test setup script, never committed as a binary if the setup can build it).

## Code shape
- `local-api.ts`: the HTTP adapter of the contracts' local API shapes, sending `X-Wowc-Run: $WOWC_RUN`; a stub adapter in tests.
- `tools.ts`: `get_game_state`, `find_npc`, `find_quest`, `find_object`, `suggest_gear_upgrades`, `set_waypoint`, each returning MCP content or a `ToolError`.
- `gear.ts`: `compare(equipped: ItemDetail[], candidates: ItemDetail[], classId) → Upgrade[]` pure; wrong armour class excluded; slot match by `equipLoc`.
- stdio server only; no tool writes files or runs a shell (D14).

## Tests first
- `mcp.<tool>` — parent — AC 9
- `mcp.not_connected` — parent — AC 9
- `gear.compare` — parent, incl. the `item_timeout` path — AC 10

## Must not change
- `apps/mcp` never imports `apps/companion` (parent `## Architecture`).

## Must refuse
- No game connected → `not_connected`; item lookup > 10 s → `item_timeout`, answer says details are missing; waypoint with no active ask → `no_active_ask` (parent Must refuse).

## The point everything turns on
`suggest_gear_upgrades` compares client-sourced details, QuestieDB only proposes candidates (D7). Check against: `gear.compare` inputs are `ItemDetail` from the local API stub, never Questie columns.

## Acceptance Criteria
1. `[file]` Parent AC 9, MCP part. Fixture: `apps/mcp/test/fixtures/mini.sqlite`
2. `[file]` Parent AC 10. Fixture: none

## Open questions
none

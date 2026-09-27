# wow-companion-v1 / 07 — addon game context: state, items, mentions, waypoint

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D4, D7, D8; `Snapshot`, `ItemDetail`, `Mention`, `Waypoint`; `## UX / flow` `@` and waypoint bullets.

## Lane key
wow-companion-v1-07-addon-context

## Depends on
02, 03

## Shared files
Fills its seeded files: `addon/WoWCompanion/{State,Items,Mention,Waypoint}.lua`, `tests/lua/stubs/context.lua`, `tests/lua/globals/context.lua`, `docs/client-facts.md` section "Items and waypoint".

## Scope
Owned: the four Lua files above, `tests/lua/{context_snapshot,mention_match,waypoint_guard}_test.lua`. Also `tests/lua/stubs/context.lua` and `tests/lua/globals/context.lua`.

## Code shape
Lua, all under `ns` (no new globals):
- `ns.State.snapshot() → Snapshot` (table shape = parent `Snapshot`), `ns.State.delta(prev, next) → Partial<Snapshot> | nil` (shallow: a changed top-level key is sent whole).
- `ns.Items.details(ids) → ItemDetail[]` via the client's `C_Item` call (name recorded in client-facts); uncached items retried on `ITEM_DATA_LOAD_RESULT`, answered once all resolve or 8 s pass (the companion's timeout is 10 s).
- `ns.Mention.match(query, candidates) → { items: Candidate[] (max 8), ghost: string | nil }` pure; `ns.Mention.candidates()` from quest log + bags + equipped.
- `ns.Waypoint.set(wp) → true | "no_waypoint_map"` — `C_Map.CanSetUserWaypointOnMap` false or x/y outside 0-100 → no `SetUserWaypoint` call; else set + `C_SuperTrack.SetSuperTrackedUserWaypoint(true)`.
The mention popup UI and the Tab/ghost rendering belong to slice 09 (chat edit box); this slice gives it `match` and `candidates`.

## Tests first
- `context.snapshot` — parent AC 16 bullet — AC 16
- `mention.match` — parent Tests first — AC 11
- `waypoint.guard` — parent AC 14 — AC 14

## Must not change
- Parent `## Must not change` (no protected calls, no deprecated chat globals).

## Must refuse
- `@` with no match → empty `items`, `ghost` nil (parent Must refuse).
- Waypoint guard per parent Must refuse.

## The point everything turns on
Item stats come from the client, never from QuestieDB (D7). Check against: `ItemDetail.stats` filled only from the recorded `C_Item` call.

## Acceptance Criteria
1. `[file]` Parent AC 11. Fixture: `.tools/lua51`
2. `[file]` Parent AC 14. Fixture: stubbed `C_Map`/`C_SuperTrack` in `tests/lua/stubs/context.lua`
3. `[file]` Parent AC 16, `context.snapshot` bullet. Fixture: `tests/lua/wow_stubs.lua`
4. `[file]` Parent AC 6, Items and waypoint part: the `C_Item` stat call and waypoint/super-track "unrestricted", each with a `forever` source path:line. Fixture: wow-ui-source `forever` clone

## Open questions
none

# wow-companion-v1 / 03 — contracts

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — `## API / interface`, `## Code shape`, D18.

## Lane key
wow-companion-v1-03-contracts

## Depends on
01

## Shared files
none (owns `packages/contracts/**`; every TS slice imports it read-only)

## Scope
Owned: `packages/contracts/src/**`, `packages/contracts/test/**`.

## Code shape
Every type of the parent's `## API / interface` and `## Code shape`, verbatim: `GameToCompanion`, `CompanionToGame` (with `ack`), `Mention`, `Waypoint`, `Snapshot`, `ItemDetail`, `Upgrade`, `McpLaunch`, `GameLink`, `ProviderId`, `Effort`, `Result`, the error unions, `ProviderConfig`, `Provider`, `CreateProvider`, `ProviderEvent`; the local API request/response shapes of `GET /state`, `POST /items`, `POST /waypoint` and the `X-Wowc-Run` header name as a constant.
Pure parsers, no I/O:
```ts
parseGameToCompanion(json: unknown): Result<GameToCompanion, "bad_frame">
parseCompanionToGame(json: unknown): Result<CompanionToGame, "bad_frame">
```
`createMemoryLink(): GameLink & { push(m: GameToCompanion): void; sent(): CompanionToGame[]; setConnected(c: boolean): void }` — the in-memory adapter of `GameLink` (parent, GameLink paragraph); keeps order, no batching.

## Tests first
- `contracts.parse` — every message variant round-trips through `JSON.stringify` → parser; unknown `t`, missing field, wrong type → `bad_frame` — AC 25
- `contracts.memorylink` — `push` then `messages()` yields in order; `send` records into `sent()`; `status().connected` follows `setConnected` — AC 25

## Must not change
- No import from `apps/`; no `fs`, `net`, `child_process`, `http` import (parent AC 25).
- Type names and shapes exactly as the parent writes them; a change is a parent-spec change, raised to the PM.

## Must refuse
- A parser given a valid-looking message with an extra unknown `t` → `bad_frame`, never a partial value.

## The point everything turns on
Every wave-2 and wave-3 slice builds against these types in parallel. Check against: each type name in the parent's two code blocks exported from `packages/contracts/src/index.ts`.

## Acceptance Criteria
1. `[file]` `contracts.parse` and `contracts.memorylink` pass. Fixture: none
2. `[file]` Parent AC 25, contracts part: zero imports from `apps/` and from `fs`, `net`, `child_process`, `http` under `packages/contracts/`. Fixture: none
3. `[file]` Every type named in the parent's `## API / interface` and `## Code shape` code blocks is exported from `packages/contracts`. Fixture: none

## Open questions
none

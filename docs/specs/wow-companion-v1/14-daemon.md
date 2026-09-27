# wow-companion-v1 / 14 — daemon wiring, local API, closure

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — `## Architecture`, Local API paragraph, `## Data model` `config.json`, `game.json`; AC 1, 2, 6 (closure), 21.

## Lane key
wow-companion-v1-14-daemon

## Depends on
08, 11, 12, 13 (last wave, integration)

## Shared files
Empties `knip.json` `ignoreDependencies` (01 owns the file; this slice is its last editor).

## Scope
Owned: `apps/companion/src/{main,config,local-api-server,runner}.ts`, `apps/companion/test/daemon/**`, `config.example.json`; `knip.json` (empty `ignoreDependencies` only).
Thin by design: wiring only. Any behaviour missing from 08, 11, 12 or 13 is a finding routed to the PM, not code added here.

## Code shape
- `main.ts`: load `config.json`, build `createScreenLink`, the enabled providers, the chats core, the state store; loop `GameLink.messages()` → core → effects.
- `runner.ts`: runs a provider for an ask with `runId = ask.id`, streams `progress`, attaches a waypoint posted under that run id to the `reply`, 600 s timeout → `timeout`.
- `local-api-server.ts`: `127.0.0.1:{companionPort}` only; `GET /state`, `POST /items` (10 s → `item_timeout`), `POST /waypoint` (`X-Wowc-Run` → ask, unknown → 409).
- `game.json`: the last snapshot, written on each `state` delta, read at start as the last known context; `GET /state` still returns `not_connected` until a `hello` arrives (parent Must refuse).
- On `hello`: send `options`, `chats`, `history` of the active chat (re-sent after a SavedVariables wipe).

## Tests first
- `api.waypoint_run` — parent — AC 9
- `daemon.hello` — `hello` on a memory link → `options`, `chats`, `history` sent in that order — AC 22

## Must not change
- Local API binds `127.0.0.1` only; parent `## Must not change` in full.

## Must refuse
- Waypoint with unknown run id → 409 / `no_active_ask`.

## The point everything turns on
The one place every seam meets. Check against: `api.waypoint_run` with two concurrent asks on a memory link and fake providers.

## Acceptance Criteria
1. `[file]` Parent AC 9, `api.waypoint_run`. Fixture: none
2. `[file]` Parent AC 1 and AC 2 over the whole tree: typecheck, zero `any`/`@ts-ignore`, every test named in the parent's `## Tests first` exists and passes. Fixture: `.tools/lua51`
3. `[file]` Parent AC 6 closure: every item of AC 6 present in `docs/client-facts.md` with a source. Fixture: none
4. `[file]` `knip.json` `ignoreDependencies` is empty and `pnpm run knip` exits 0. Fixture: none
5. `[file]` Parent AC 13, `config.example.json` part: placeholders only. Fixture: none
6. `[post-deploy]` Parent AC 21, listed in `HANDOFF-INTENT.md` for the user; pre-push twins AC 3, 11, 14, 16, 17, 20. Fixture: user logged into Forever, companion running

## Open questions
none

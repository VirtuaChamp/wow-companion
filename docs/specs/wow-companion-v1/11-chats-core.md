# wow-companion-v1 / 11 — companion chats core

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D9, D11; `## Code shape` paths (ask); `## Data model` `chats.json`; Tests first `chats.*`, `settings.apply`.

## Lane key
wow-companion-v1-11-chats-core

## Depends on
03

## Shared files
none

## Scope
Owned: `apps/companion/src/core/{chats,prompt,settings}.ts`, `apps/companion/src/adapters/state-store.ts`, `apps/companion/test/core/**`.

## Code shape
Pure core (`src/core/`, no I/O, parent `## Architecture`):
- `Chats` — create/open/rename/delete/reset/cancel, one running ask per chat, parallel across chats, unread counts, last 200 history lines, resume by stored session id; on `session_unknown` a fresh session with a transcript summary in the prompt and a notice line.
- `Prompt.build(snapshot, mentions, transcriptSummary?) → string`.
- `Settings.apply(current, msg, options) → Result<Settings, "error">` — global or chat-only; unknown model, unsupported effort, disabled provider → error, previous kept.
All outputs are `CompanionToGame` values and requests to run/cancel a provider; the daemon (14) executes them against `GameLink` and `Provider`. `state-store.ts` reads/writes `apps/companion/state/chats.json` atomically.

## Tests first
- `chats.lifecycle` — parent — AC 22
- `chats.busy` — parent — AC 8
- `settings.apply` — parent — AC 17

## Must not change
- `src/core/` imports no Node I/O module.

## Must refuse
- Ask on a running chat → `busy` (AC 8). Settings refusals per parent Must refuse (AC 17).

## The point everything turns on
Parallel chats with per-chat sessions and resume. Check against: `chats.busy` running two chats at once, `chats.lifecycle` resuming after `session_unknown`.

## Acceptance Criteria
1. `[file]` Parent AC 8. Fixture: none
2. `[file]` Parent AC 17, `settings.apply`. Fixture: none
3. `[file]` Parent AC 22, `chats.lifecycle`. Fixture: none
4. `[file]` Zero imports of `fs`, `net`, `child_process`, `http` under `apps/companion/src/core/`. Fixture: none

## Open questions
none

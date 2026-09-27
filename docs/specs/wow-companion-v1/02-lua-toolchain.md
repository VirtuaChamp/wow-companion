# wow-companion-v1 / 02 — lua toolchain, guard, addon seed

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — `## Client behaviour facts`, `## Must not change`, `## Proof of done`.

## Lane key
wow-companion-v1-02-lua-toolchain

## Depends on
01

## Shared files
Creates the seeds every addon slice fills: `addon/WoWCompanion/WoWCompanion.toc`, one empty module per addon file, `tests/lua/stubs/*.lua`, `tests/lua/globals/*.lua`, `docs/client-facts.md` section skeleton (see `SHARED-FILES.md` for owners).

## Scope
Owned: `scripts/lua-setup.ts`, `scripts/lua-test.ts`, `scripts/guard.ts`, `tests/lua/bit_shim.lua`, `tests/lua/wow_stubs.lua`, `.luacheckrc`.
Seeded here, owned afterwards by the slice named in `SHARED-FILES.md`: `addon/WoWCompanion/WoWCompanion.toc` (final file list: `Codec.lua`, `Inbox.lua`, `Core.lua`, `State.lua`, `Items.lua`, `Mention.lua`, `Waypoint.lua`, `AiWindow.lua`, `Settings.lua`, `Report.lua`; `## Interface: 16001`, `## Version: 0.1.0`, `## SavedVariables: WoWCompanionDB`), each of those `.lua` files as `local _, ns = ...` and nothing else, `tests/lua/stubs/{transport,context,chat,panels}.lua` and `tests/lua/globals/{transport,context,chat,panels}.lua` (empty tables), `docs/client-facts.md` with one heading per section: Client (this slice fills it), Transport (13), Items and waypoint (07), Chat window and edit box (09), Settings and report (10), Providers (08).

`wow_stubs.lua` loads `bit_shim.lua` and every `stubs/*.lua` in a fixed list; `.luacheckrc` builds `read_globals` from `globals/*.lua` the same way, so no addon slice edits either loader.

## Code shape
- `lua:setup` downloads LuaBinaries 5.1.5 into `.tools/lua51/` (Windows and Linux), idempotent.
- `lua:test` runs every `tests/lua/*_test.lua` under that binary, non-zero on any failure, prints each test name.
- `lua:lint` = luacheck `--std lua51` + the 5.2+ syntax ban over `addon/` (parent `## Proof of done`).
- `guard` = every grep of parent `## Must not change` plus: every `uses:` in `.github/workflows/*.yml` pinned to a 40-hex SHA with a `# vX.Y.Z` comment (parent AC 24). Exits non-zero naming file:line.

## Tests first
- `guard.detects` — vitest: a temp tree with one planted violation per rule → guard fails naming it; a clean tree → exit 0 — AC 15
- `bitshim.ops` (Lua) — `band`, `bor`, `bxor`, `lshift`, `rshift` on 0, 1, 0xFFFF, 0xFFFFFFFF match the client's 32-bit semantics — AC 15

## Must not change
- Parent `## Must not change` in full; `pnpm-lock.yaml` and every `package.json` (frozen by 01).

## Must refuse
- A 5.2+ construct in `addon/` → `lua:lint` fails naming the line.
- A tracked file matching the secret patterns of parent D12 → `guard` fails.

## The point everything turns on
Lua runs under real 5.1.5 on both Windows and CI Linux; a 5.2+ VM silently accepts code the client rejects. Check against: `.tools/lua51/lua -v` prints `Lua 5.1.5`.

## Acceptance Criteria
1. `[file]` Parent AC 15: `pnpm run guard` and `pnpm run lua:lint` exit 0 on the tree. Fixture: none
2. `[file]` `pnpm run lua:setup && pnpm run lua:test` exit 0; `bitshim.ops` and `guard.detects` pass. Fixture: `.tools/lua51`
3. `[file]` Parent AC 6, Client part: `docs/client-facts.md` records interface 16001 (in-client 2026-09-26), `WowB.exe`, the AddOns path shape, each with a source. Fixture: none

## Open questions
none

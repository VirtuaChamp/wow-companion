# Shared-file coordination — wow-companion-v1

These files are touched by more than one slice. Each is created once by a seeding slice, then edited only in the section or line its owner is named for below. A builder that needs a change outside its row asks the PM; it never edits another slice's part.

| Shared file | Created by | Later edits | What each adds |
|---|---|---|---|
| `package.json`, `apps/*/package.json`, `packages/contracts/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | 01 | none (frozen) | 01 declares every dependency of every slice; a missing one is raised to the PM, who adds it on the base before the next wave |
| `vitest.config.ts` | 01 | 03 | 03 removes `passWithNoTests` once its first test exists |
| `knip.json` | 01 | 14 | 01: `ignoreDependencies` for packages not yet imported; PM (2026-09-27): temporary app entries `src/adapters|core|transport/**` (companion) and `src/**` (mcp) so factories count as used before 14 wires them, `ignoreBinaries` claude, codex, cursor-agent (not npm); 14 empties `ignoreDependencies` and narrows the entries back to `src/main.ts` / `src/server.ts` |
| `docs/versions.md` | 01 | 04 | 01: Node + npm rows; 04 appends GitHub Action rows below them |
| `addon/WoWCompanion/WoWCompanion.toc` | 02 | 04 (release-please `## Version` bump config only, no edit) | final file list; no slice edits it |
| `addon/WoWCompanion/*.lua` (10 empty modules) | 02 | 06 `Codec`, 07 `State`/`Items`/`Mention`/`Waypoint`, 09 `Core`/`AiWindow`, 10 `Settings`/`Report`, 13 `Inbox` | each fills only its own files |
| `tests/lua/wow_stubs.lua`, `.luacheckrc` | 02 | none | loaders over `tests/lua/stubs/*.lua` and `tests/lua/globals/*.lua` |
| `tests/lua/stubs/{transport,context,chat,panels}.lua`, `tests/lua/globals/{…}.lua` | 02 | 13 `transport`, 07 `context`, 09 `chat`, 10 `panels` | Blizzard stubs and read-globals per area |
| `docs/client-facts.md` | 02 (headings + Client section) | 13 Transport, 07 Items and waypoint, 09 Chat window and edit box, 10 Settings and report, 08 Providers; 14 checks completeness | each fills only its own section |
| `scripts/db-schema.sql` | 05 | none | 12 reads it for `mini.sqlite` |

## Recommended order (waves, at most five builders at once)
1. Wave 0: 01 node-toolchain
2. Wave 1: 02 lua-toolchain, 03 contracts
3. Wave 2: 04 repo-meta, 05 build-db, 06 codec, 07 addon-context, 08 providers
4. Wave 3: 09 addon-window, 10 addon-panels, 11 chats-core, 12 mcp-server, 13 game-link
5. Wave 4: 14 daemon

Merge order within a wave: ascending slice id.

## Why 14 slices, not at most 10
The size caps (8 criteria, 6 owned files, 10 tasks per slice) come from measured builder failures; the 5-10 slice count is a guide against over-splitting. Where they conflict the caps win. The only cap exceptions are 01, 02 and 04, whose extra files are declarative config, seeds and templates with no logic; their task count stays under 10.

## Open slice findings
- 04 (from slice 01 gate, 2026-09-27): the apps run on Node native type stripping, which refuses files under node_modules. release.yml must ship packages/contracts/src as real files outside node_modules (no symlink dereference into node_modules), and the release check must run node apps/mcp/src/server.ts from the unzipped artifact.
- every TS slice: runtime is node <file>.ts (erasable TypeScript only, relative imports end in .ts), see AGENTS.md.
- 04 (from slice 02 gate, 2026-09-27): lua:test and lua:lint use .tools/ when present, otherwise lua5.1 or lua and luacheck on PATH, and fail closed unless the interpreter reports Lua 5.1.5. ci.yml installs Lua 5.1.5 with leafo/gh-actions-lua and luacheck with leafo/gh-actions-luarocks (both SHA-pinned), or runs pnpm run lua:setup; either way lua:test and lua:lint run.
- 06, 07, 09, 10, 13 (from slice 02 gate): tests/lua/stubs/<area>.lua installs its Blizzard stubs directly into _G as a side effect and returns nothing; tests/lua/globals/<area>.lua returns an array of global names for luacheck. Bit operations stay on values below 2^31 (bit_shim sign semantics are unverified in the client).
- 13 and client-facts (from slice 02 gate): wowPath is the flavour folder that holds WowB.exe (the _classic_beta_ folder); the AddOns path is `{wowPath}/Interface/AddOns/` (backslashes on Windows).
- 07, 12, 14 (from slice 03 gate, 2026-09-27): the addon's first state message after hello carries every Snapshot key; the daemon answers GET /state with not_connected until it holds a full Snapshot. Every local API response body is a Result (contracts exports the types and parsers); unknown waypoint run is HTTP 409 with error no_active_ask.
- 06, 07, 13 and every TS consumer (from slice 03 gate): Lua has one empty table; the contracts parsers accept [] for an empty record and {} for an empty array and return the declared type, so the Lua encoder may write either.
- 04 (PM, 2026-09-27): exception to the freeze: slice 04 adds `"version": "0.1.0"` to root package.json (release-please bumps it) and `injectWorkspacePackages: true` to pnpm-workspace.yaml (release zip via pnpm deploy), and owns scripts/build-release-zips.ts. pnpm-lock.yaml changes with it (injectWorkspacePackages); slice 04 owns that lockfile change, and later slices pick it up by merging the base before their gate.
- 12 (from slice 05 cross-check, 2026-09-27): npc.friendly_to is TEXT (the real QuestieDB value is a string); the database layout follows QuestieDB master 365537a as recorded in slice 05's handoff.
- 09, 10, 13 (from slice 07): uncached equipped items are omitted from a snapshot until their data loads (never an invented item level); ns.Items.details(ids, onDone) is asynchronous.
- 14 (from slice 12, PM 2026-09-27): McpLaunch.env for the MCP server carries WOWC_RUN, WOWC_DB_PATH and WOWC_PORT, all required (the MCP server has no defaults).
- 14 (from slice 08 gate, PM 2026-09-27): the provider runId is minted by the companion (matching ^[A-Za-z0-9_-]{1,64}$), never the addon's ask.id passed through; the adapters keep rejecting any other runId.
- 09, 13 (from slice 09 gate, PM 2026-09-27): ns.Transport.onMessage(fn) is Inbox.lua's registration function; Core.lua registers its dispatcher through it on ADDON_LOADED and never assigns the field.
- 09, 10, 14 (from slice 10 gate, PM 2026-09-27): options carries `active` (global Choice) and `chat` (the active chat's own Choice, when set) instead of defaultProvider, and is re-sent on hello, after every settings message (applied or refused) and on every active-chat change (slice 14 sends it; slice 11 exposes both choices). Slice 10 owns the contracts change.
- 09 (from slice 10 gate, PM 2026-09-27): Core.lua dispatch sends options to ns.Settings.onOptions, chats to AiWindow and ns.Settings.onChats, error to AiWindow and ns.Settings.onError; AiWindow exposes ns.AiWindow.notice(text) (one system line in the Claude window) used by Settings for the now-using line and settings errors.

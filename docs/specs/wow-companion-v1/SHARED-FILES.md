# Shared-file coordination — wow-companion-v1

These files are touched by more than one slice. Each is created once by a seeding slice, then edited only in the section or line its owner is named for below. A builder that needs a change outside its row asks the PM; it never edits another slice's part.

| Shared file | Created by | Later edits | What each adds |
|---|---|---|---|
| `package.json`, `apps/*/package.json`, `packages/contracts/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | 01 | none (frozen) | 01 declares every dependency of every slice; a missing one is raised to the PM, who adds it on the base before the next wave |
| `vitest.config.ts` | 01 | 03 | 03 removes `passWithNoTests` once its first test exists |
| `knip.json` | 01 | 14 | 01: `ignoreDependencies` for packages not yet imported; 14 empties it |
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

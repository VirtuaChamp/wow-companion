# wow-companion-v1 / 01 — node toolchain

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D5, D12, D16, D18; `## Proof of done`.

## Lane key
wow-companion-v1-01-node-toolchain

## Depends on
none (wave 0)

## Shared files
Creates and then freezes `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `knip.json`, every workspace `package.json` (see `SHARED-FILES.md`).

## Scope
Owned: root `package.json` (scripts `lint`, `format:check`, `knip`, `typecheck`, `test`, `lua:setup`, `lua:test`, `lua:lint`, `guard`; `engines.node`), `pnpm-workspace.yaml` (workspaces `apps/*`, `packages/*`, catalog, `minimumReleaseAge`), `pnpm-lock.yaml`, `tsconfig.base.json`, root `tsconfig.json` (project references), `.oxlintrc.json`, oxfmt config, `knip.json`, `vitest.config.ts`, `.gitignore`, `.editorconfig`, `.env.example`, `AGENTS.md`, `CLAUDE.md`, `docs/versions.md`, `apps/companion/{package.json,tsconfig.json,src/index.ts}`, `apps/mcp/{package.json,tsconfig.json,src/index.ts}`, `packages/contracts/{package.json,tsconfig.json,src/index.ts}`.

Every dependency any later slice needs is declared here, once, through the catalog: typescript, vitest, cross-spawn, better-sqlite3, @anthropic-ai/claude-agent-sdk, @modelcontextprotocol/sdk, oxlint, oxfmt, knip, and a TS runner for `scripts/*.ts`. Packages not yet imported go in `knip.json` `ignoreDependencies`; slice 14 empties that list. The `lua:*` and `guard` scripts are declared here and point at files slice 02 creates, so they are not part of this slice's proof-of-done.

## Code shape
No application code. `src/index.ts` files are empty modules (`export {}`) so `tsc -b` and knip have an entry.

## Tests first
- none: no behaviour. `vitest.config.ts` sets `passWithNoTests` so `pnpm test` is green until slice 03 adds the first test.

## Must not change
- Parent `## Must not change` in full.
- Versions come from live lookups (D16), written with date and command into `docs/versions.md`; none from memory.

## Must refuse
- A `latest` younger than `minimumReleaseAge` (3 days): take the newest version at least 3 days old, record both in `docs/versions.md` with the reason (parent D16, user choice 2026-09-27); never lower `minimumReleaseAge` or add an exclude.

## The point everything turns on
The catalog and lockfile are frozen after this slice: every later slice builds on these exact versions without touching `pnpm-lock.yaml`. Check against: every package named in this slice's Scope present in the catalog; `pnpm install --frozen-lockfile` green from a clean clone.

## Acceptance Criteria
1. `[file]` Parent AC 13, `.gitignore` part: covers `data/`, `apps/companion/state/`, `config.json`, `.env`, `.tools/`, `.claude/output/`; `.env.example` holds placeholders only. Fixture: none
2. `[file]` Parent AC 25 except the `packages/contracts` import rule (slice 03): catalog + `minimumReleaseAge`, every shared dependency `catalog:`, five strict flags in `tsconfig.base.json`, `lint`, `format:check`, `knip` exit 0, `CLAUDE.md` is exactly `@AGENTS.md`, `AGENTS.md` states the D1-D18 builder rules. Fixture: none
3. `[file]` Parent AC 24, versions part: `docs/versions.md` lists every resolved version with date and lookup; `engines.node` equals the resolved Active LTS. Fixture: none
4. `[file]` `pnpm install --frozen-lockfile && pnpm run typecheck && pnpm test` exit 0. Fixture: none

## Open questions
none

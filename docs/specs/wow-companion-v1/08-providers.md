# wow-companion-v1 / 08 — providers

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D5, D14; `Provider`, `ProviderConfig`, `ProviderError`, `McpLaunch`; Local API paragraph (`WOWC_RUN`).

## Lane key
wow-companion-v1-08-providers

## Depends on
03

## Shared files
`docs/client-facts.md` section "Providers" (seeded by 02).

## Scope
Owned: `apps/companion/src/adapters/providers/{claude,codex,cursor,spawn}.ts`, `apps/companion/test/providers/**` (tests + recorded stream fixtures).

## Code shape
`createClaude`, `createCodex`, `createCursor`: each a `CreateProvider` (parent `## Code shape`). Read-only policy fixed inside each adapter (parent `## Code shape` bullet: claude `allowedTools`, codex `sandboxMode: "read-only"`, cursor without `--force`). `McpLaunch` from `config.mcp(runId)` with `env.WOWC_RUN = runId`. `spawn.ts` wraps `cross-spawn` and `AbortSignal` → kill the process tree → `cancelled`.

## Tests first
- `provider.<id>.stream` — parent — AC 7
- `provider.<id>.describe` — parent — AC 17
- `provider.<id>.cancel` — parent — AC 7
- `provider.<id>.session_unknown` — parent — AC 7

## Must not change
- D14: no shell tool reachable for any provider; an edit or write tool a provider cannot remove must be refused by the provider's read-only sandbox policy (codex: `-s read-only`, approval never), proven by a recorded write attempt that is refused and leaves the file unchanged (user choice 2026-09-27; an OS-level denial is not required).

## Must refuse
- Missing binary → `provider_missing`; disabled → `provider_disabled`; auth failure text → `provider_auth` (parent Must refuse).

## The point everything turns on
Cursor headless may block on MCP approval or lack login reuse (parent Risk). Check against: a real `cursor-agent` run recorded as the fixture; if it blocks, `enabled: false` with the reason.

## Acceptance Criteria
1. `[file]` Parent AC 7, including `cancel` and `session_unknown` for all three providers. Fixture: `apps/companion/test/providers/fixtures/`
2. `[file]` Parent AC 17, `describe` part. Fixture: none
3. `[file]` Parent AC 6, Providers part: whether cursor headless MCP works, env support in each provider's MCP config, each with the command run and its date. Fixture: the three CLIs installed and logged in on this machine

## Open questions
none

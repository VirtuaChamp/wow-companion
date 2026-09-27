# AGENTS.md

Rules for any contributor, human or AI agent, working in this repo. `CLAUDE.md` is `@AGENTS.md`; every AI tool reads this file.

- Give AI tools read-only capability only: game state reads, world-data lookups, waypoint setting, web search. Never shell access, never file writes, for any provider (D14).
- Never send input to the game and never read its process memory. No `SendInput`, `keybd_event`, `PostMessage`, `SendKeys`, `ReadProcessMemory`, `robotjs`, `nut-js` anywhere in `apps/companion/` or `apps/mcp/`.
- Build every UI element from native Blizzard templates, fonts, colours, atlases and sounds only (D10). No custom art, fonts or colour palettes; no `.tga`/`.blp`/`.ttf`/`.otf` files under `addon/`.
- Write the addon from scratch. Copy no third-party code, identifiers or file formats into this repo (D2).
- Never commit a secret, token, API key, account id, character name, realm name or absolute user-profile path. Real values live only in gitignored `config.json` / `.env`; committed `.example` files hold placeholders only (D12).
- Target Lua 5.1 only in `addon/`. No 5.2+ syntax: no `//`, no bitwise `&`/`|`/`~`/`<<`/`>>`, no `goto`, no `::labels::`.
- Title every PR as a conventional commit (`feat:`, `fix:`, `chore:`, …); `!` or a `BREAKING CHANGE` footer for a breaking change. `release-please` reads these titles to version the repo (D15).
- Work trunk-based: one long-lived branch `master`. Branch `feature/*` or `fix/*` from `master`, return by PR, squash merge only. Nothing reaches `master` without a green PR (D15).
- Declare every shared dependency once, in the pnpm catalog (`pnpm-workspace.yaml`), referenced as `catalog:` from each workspace `package.json`. Never hand-pin a version that duplicates the catalog. The lockfile is frozen after slice 01: do not edit `pnpm-lock.yaml` directly, and raise a missing dependency to the PM instead of adding it unreviewed.
- Versions come from a live registry lookup recorded in `docs/versions.md`; never lower `minimumReleaseAge` or add an exclude — take the newest version at least 3 days old (D16).
- Code runs on Node's type stripping: erasable TypeScript only (no enums, namespaces, parameter properties), relative imports end in `.ts`.
- Respect the parent spec's `## Must not change` (`docs/specs/wow-companion-v1.md`) in full: no third-party source, `.gitignore`d state stays untracked, no protected/`HasRestrictions` addon calls, no deprecated chat globals, local API binds `127.0.0.1` only, public-repo secret rules, no custom art or fonts.
- Build the chat UI in a separate floating Blizzard window, using native frame templates (D1, D10).
- Source world knowledge from QuestieDB-built SQLite; web search as fallback only (D3).
- Get item stats and quality from the game client `C_Item` API; QuestieDB proposes candidates only (D7).
- Put all settings in the native Blizzard Settings panel (Options > AddOns), never custom UI (D9).
- Allow multiple concurrent chats, each with its own provider session; all histories persist and resume (D11).
- Licence as MIT; ensure no third-party code contradicts this (D13, D2).
- Set Dependabot for weekly `npm` and GitHub Actions updates with conventional-commit titles for `release-please` (D17).
- Lint with oxlint and oxfmt; run knip in CI; tsconfig `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` (D18).
- The decisions table D1-D18 in docs/specs/wow-companion-v1.md binds in full; these bullets summarise it.

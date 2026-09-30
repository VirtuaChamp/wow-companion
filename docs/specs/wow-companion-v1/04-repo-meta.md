# wow-companion-v1 / 04 — repo automation and policy

## Parent
[../wow-companion-v1.md](../wow-companion-v1.md) — D12, D13, D15, D16, D17; AC 18, 19, 23, 24.

## Lane key
wow-companion-v1-04-repo-meta

## Depends on
01, 02 (CI runs `lua:*` and `guard`)

## Shared files
none

`README.md` already exists when this slice starts (branch `feature/readme-installer` created it: install steps, configuration, troubleshooting, contributor checks): this slice extends it (licence section and the rest) instead of creating it.

## Scope
Owned: `.github/workflows/{ci,release,release-please,pr-title}.yml`, `.github/dependabot.yml`, `.github/rulesets/{master,release-tags}.json`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/pull_request_template.md`, `.github/CODEOWNERS`, `release-please-config.json`, `.release-please-manifest.json`, `docs/branching.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `scripts/actionlint.ts` (downloads the actionlint release binary into `.tools/actionlint/` if absent, runs it over `.github/workflows/`; run by `pnpm run lint:actions`; PM decision 2026-09-27: actionlint is not installed on this machine); `docs/versions.md` append-only (GitHub Action rows below 01's rows).
Declarative files only; the file-count cap does not apply (see `SHARED-FILES.md`).

## Code shape
No application code. Every action SHA resolved live (`git ls-remote https://github.com/<owner>/<action> refs/tags/<tag>`, peeled `^{}` sha for annotated tags; the `gh` CLI is not installed) and added to `docs/versions.md` — the one line in that file this slice appends (01 owns the file; append-only below the last row).

## Tests first
- none beyond `actionlint` and `pnpm run guard` (SHA pins) — AC 18, 24

## Must not change
- Parent `## Must not change` in full; no secret, account id or absolute user path in any workflow.
- The prior-art check never prints `PRIOR_ART_PATTERNS` and fails closed when the secret is unset.

## Must refuse
- Bug form submitted without client build, addon version, companion version, provider/model/effort, steps, expected/actual → refused by `required: true` (parent AC 19).
- A release tag whose commit is not on `master` → release build fails (parent AC 23).

## The point everything turns on
CI is the only gate into `master` (D15). Check against: `ci.yml` runs the parent's proof-of-done line exactly, and the ruleset requires the check named `ci`.

## Acceptance Criteria
1. `[file]` Parent AC 18. Fixture: none
2. `[file]` Parent AC 19. Fixture: none
3. `[file]` Parent AC 23. Fixture: none
4. `[file]` Parent AC 24 except `docs/versions.md` npm rows and `engines.node` (slice 01). Fixture: none
5. `[file]` `LICENSE` is MIT, `Copyright (c) 2026 VirtuaChamp` (D13). Fixture: none

## Open questions
none

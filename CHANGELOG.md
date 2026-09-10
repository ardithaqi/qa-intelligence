# Changelog

All notable changes to `qa-intelligence` are documented here.

## 1.5.3

### Fixed

- AI failure JSON parsing now tolerates a trailing ` ```json ` markdown fence (or any trailing text)
  around SECTION 2 — some providers (notably Claude/Anthropic) wrap it despite the prompt saying not
  to, which previously broke `JSON.parse` and silently dropped the failure from the diff

### Added (scaffolded CI template)

- `concurrency` guard — cancels superseded PR runs only, never a push/merge run mid-flight, so a
  test's cleanup (e.g. restoring a shared fixture in a `finally`) can't get killed mid-run
- Push (merge) runs now reuse the merged PR's already-completed results instead of re-running the
  full Playwright suite, falling back to a fresh run when no reusable result is found
- New `docs/recipes.md` for patterns not baked into the default template (e.g. monorepo path filtering)

### Changed (scaffolded CI template)

- Failure-history cache key uses a per-run key (`github.run_id`) with a repo-scoped `restore-keys`
  prefix, instead of either a per-commit SHA (never restores prior history) or a single permanently
  stable key (restores fine, but `actions/cache` skips saving once a run gets an exact hit on the
  primary key, so a stable key alone still stops accumulating history after its first save)

## 1.5.2

### Fixed

- Init workflow template: restore missing `fi` in the "Check baseline artifact" shell step so the "no baseline yet" branch does not fail with a syntax error

### Changed

- Init workflow template: expose a non-secret job-level `HAS_AI_KEY` flag instead of relying on secret presence only at the test step; API key secrets remain step-scoped

## 1.5.1

### Fixed

- AI cost rollup and "Saved AI summary: ..." line printed at the very end of the terminal output, after Playwright's own list-reporter summary and HTML report note — previously `globalTeardown` logged them before tests finished reporting, so they appeared above failure stack traces instead of at the bottom

### Added

- `qa-intelligence/playwright/reporter` — official Playwright reporter (`AiSummaryReporter`); register it last in `playwright.config.ts` to print the rollup after all other reporters
- `QA_INTELLIGENCE_TEARDOWN_LOGS` env var (default `false`) to restore `globalTeardown`'s inline provider/analyzing/rollup logs if needed

### Changed

- `globalTeardown` is quiet by default: it still writes `ai.txt`, `ai-summary.md`, and a new `ai-summary.json` (consumed by the reporter), but no longer prints the rollup itself
- Init template's `playwright.config.ts` reporter list now includes `list` and the new `qa-intelligence/playwright/reporter` entry alongside `html`

## 1.5.0

### Changed

- Anthropic provider always logs token usage and estimated cost after each call (no `AI_VERBOSE` gate)
- Per-model Anthropic pricing with substring fallbacks (`opus`, `haiku`, default sonnet) in shared `estimateCost.ts`
- OpenAI providers use the same unconditional usage/cost logging helper

## 1.4.6

### Changed

- Init workflow template uses Node 24–compatible actions (`checkout`/`setup-node`/`upload-artifact` v6, `dawidd6/action-download-artifact` v21)
- Baseline pattern: upload stable `playwright-artifacts-baseline` on default-branch push, download on PRs
- Added concurrency, npm cache, and skip diff/comment when no baseline exists yet

## 1.4.5

### Added

- End-of-run AI cost rollup in teardown (one line instead of per-failure noise)
- Combined `ai-summary.md` under the run artifact dir with all `ai.txt` analyses

## 1.4.4

### Fixed

- `qa-intelligence init` no longer fails on install from npm: scaffold `playwright/.gitignore` is shipped as `templates/playwright/gitignore` (npm always omits `.gitignore` files from packages)

## 1.4.3

### Fixed

- Flaky pass attempts now record test `file`/`line` in `meta.json` and reuse the failed attempt's error for AI analysis, so PR comments show the real spec path instead of a guessed one

## 1.4.2

### Fixed

- PR comment now updates to an all-clear summary when a previously failing PR run passes, instead of leaving a stale **New Issues** comment

## 1.4.1

### Fixed

- Init workflow cache key for failure history: repo-scoped (`failure-history-${{ github.repository }}`) instead of per-commit SHA, so recurrence and Flaky Watchlist persist across PR runs

### Changed

- README: document failure history caching in CI and how to fix existing workflows

## 1.4.0

### Added

- **Flaky Watchlist** in PR comments — tests intermittent across recent PR CI runs (from `.cache/failure-history.json`)
- Omits tests already shown as **New Issues** or **Still Failing** on the current PR
- `computeFlakyWatchlist` exported from package root for custom integrations

## 1.3.0

### Added

- Programmatic API via package root: `import { computeDiff, formatDiffComment, enrichDiffWithHistory } from "qa-intelligence"`
- `enrichDiffWithHistory` and `saveHistory` helpers in `src/lib/history.ts`
- Unit tests for package entry exports

## 1.2.0

### Added

- Pluggable AI providers: `openai` (default), `anthropic`, and `openai-compatible`
- Env-driven AI config: `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `ANTHROPIC_API_KEY`
- Unit tests for AI provider resolution and prompt building

### Changed

- `failureAnalyzer` delegates to provider registry; diff/flaky/blocking unchanged without AI keys

## 1.1.6

### Added

- `playwright/.gitignore` in init scaffold (ignores `.env`, artifacts, reports, cache)

### Changed

- README: document `AI_ANALYSIS=true` for local AI analysis

## 1.1.5

### Fixed

- AI teardown analyzes one meta.json per test (no duplicate analysis on retries)
- Resolve `@playwright/test` from consumer project (fixes `file:` / linked installs)

### Added

- `@types/node` in init template `package.json` (fixes TypeScript `node` types warning)

## 1.1.4

### Added

- `npx qa-intelligence init` — scaffolds `playwright/` and `.github/workflows/qa-intelligence.yml`
- `templates/` bundled in npm package (`playwright` config, example test, CI workflow)
- `qa-intelligence-init` bin alias

### Changed

- README quick start uses `init` flow

## 1.1.3

### Added

- Unit tests for `computeDiff`, `failureIdentity`, `format`, and `history`
- `npm test` script (Node built-in test runner via `tsx`)
- Extracted history logic into `src/lib/history.ts`

## 1.1.2

### Fixed

- PR comment now clarifies that pre-existing failures do not block merge

## 1.1.1

### Fixed

- More accurate PR diff grouping for failure keys

# Changelog

All notable changes to `qa-intelligence` are documented here.

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

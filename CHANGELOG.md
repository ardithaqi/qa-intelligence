# Changelog

All notable changes to `qa-intelligence` are documented here.

## 1.5.3

> **Note:** this repo's git history was last updated through 1.4.0, but npm already had 1.4.1–1.5.2
> published with changes never committed back here — most notably an AI-cost-tracking subsystem
> (`ai/estimateCost.ts`, `ai/aiSummary.ts`, `playwright/reporter.ts`, richer `AiAnalysisResult`/
> `failureAnalyzer` return values, `meta.json` `file`/`line` capture used as a diff fallback, a
> "clear" PR comment when a previously-red PR goes green, and the `playwright/gitignore` template
> rename that worked around npm silently dropping any packed file literally named `.gitignore`).
> Reconstructed from the published 1.5.2 tarball's compiled output (verified via a byte-for-byte
> `dist/` diff — only intentional differences remain: this fix below, and the CI-template changes
> further down) and merged back into this checkout so 1.5.3 is a strict superset of 1.5.2, not a
> regression. Versioned 1.5.3 to land after published history rather than collide with it.

### Fixed

- AI failure JSON parsing now tolerates a trailing ` ```json ` markdown fence (or any trailing text)
  around SECTION 2 — some providers (notably Claude/Anthropic) wrap it despite the prompt saying not
  to, which previously broke `JSON.parse` and silently dropped the failure from the diff

### Changed (scaffolded CI template)

- `concurrency` guard added — cancels superseded PR runs only, never a push/merge run mid-flight
- Failure-history cache key now uses `github.run_id` instead of `github.sha`, so recurrence tracking
  doesn't stop accumulating after its first save on a given commit
- AI-analysis steps (diff/history/PR comment) now auto-skip when no `OPENAI_API_KEY` is configured,
  instead of posting an "everything is new" comment with no real analysis behind it
- Push (merge) runs now reuse the merged PR's already-completed results instead of re-running the full
  Playwright suite, falling back to a fresh run when no reusable result is found
- New `docs/recipes.md` for patterns not baked into the default template (e.g. monorepo path filtering)

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

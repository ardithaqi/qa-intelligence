# Changelog

All notable changes to `qa-intelligence` are documented here.

## 2.0.2

### Fixed

- **A test could be counted twice:** attempts were merged by failure type, so when the first
  attempt was classified from the error text and the last one by the AI with a different type, the
  same test showed up as two failures (inflating the counts and the risk score). Each test now
  counts once, from its last attempt. Flaky tests were affected the same way
- List and object mismatches (`toHaveText([...])`, `toEqual({...})`) read as
  `expected ["shoes"], got []` instead of just "toHaveText failed", and the error box in the comment
  shows the differing values

## 2.0.1

### Fixed

- **Failures went unrecorded when the browser couldn't start** (e.g. a broken or missing browser
  install): the recorder depended on Playwright's `page`, so when `page` failed to set up nothing was
  written and the guardian said "SAFE TO MERGE, all tests passed". The failure is now recorded
  without a page (screenshot and DOM are still saved when there is one), and shows up as an
  infrastructure failure
- Safety net: when Playwright reports failed tests but none were recorded, the verdict is
  REVIEW REQUIRED ("N tests failed, but no failure details were recorded"), never SAFE, and the
  comment no longer says "all tests passed"
- Tests that don't use `page` no longer start a browser just for failure recording

## 2.0.0 - AI Release Guardian

The product is now **AI Release Guardian**. The npm package name, imports, existing CLIs and their
output files are unchanged. There are no breaking API changes. The major version marks the new
merge-gate behavior in the scaffolded workflow.

### Added

- `ai-release-guardian` CLI (`analyze`, `comment`, `init`):
  - classifies each failure as `regression`, `flaky`, `infrastructure`, `test_issue` or `unknown`,
    with a confidence and the evidence behind it (retries, base-branch status, history, error
    signatures, related code changes, AI agreement)
  - groups failures by probable root cause: same implicated changed file, else same normalized error
  - attributes failures to likely changed files and commits from `git diff base...HEAD`, with capped
    heuristic confidence
  - computes a deterministic 0–100 release risk score (LOW / MEDIUM / HIGH / CRITICAL) that lists
    every point it added
  - makes a final **SAFE TO MERGE / REVIEW REQUIRED / BLOCK** decision with a reason
  - `--fail-on review|block|never` merge gate (`RELEASE_GUARDIAN_FAIL_ON`)
  - writes `release-report.json` and `release-guardian.md`; posts a compact "AI Release Guardian" PR
    comment: the decision, one sentence, and one collapsible line per problem (where · why · likely
    cause), capped at 10 lines plus "…and N more". Test and cause paths link to the exact line on
    GitHub, and still-failing / fixed tests sit in one collapsed line. The score breakdown is kept
    in `release-report.json`, not the comment. A clean or
    safe PR shows just "SAFE TO MERGE" and one line, with no risk score
- AI root cause from the PR diff: with an AI key set, `analyze` makes one call with the failing tests,
  their errors and the diff of the changed files, and gets back per problem the file that broke it,
  what changed, and a fix. Shown as **AI** / **Fix** lines in the expanded problem. The pick must be a
  file in the diff, counts from 50% confidence, is capped at 85% (90% when the naming rules agree),
  and can only re-label an "Unclear" failure as a broken test when it traces it to the test's own
  code. `--ai auto|on|off` / `RELEASE_GUARDIAN_AI`
- AI summary: with 2 or more problems, the same root-cause call returns a 1 to 3 sentence overview
  shown right under the verdict, so developers get the gist before opening any problem
- The per-test AI analysis's observation line ("Root cause, Line 2" in `ai.txt`) is shown in the
  expanded problem instead of being discarded
- MCP server for AI assistants (`ai-release-guardian mcp`, name `release-guardian`): read-only tools
  `get_pr_verdict` (CI result for the PR, or "No CI result for this PR yet"), `analyze_local`
  (local run, including uncommitted changes), `explain_problem`, `flaky_tests` and
  `failure_history`, plus report resources. No AI calls of its own. `init` writes `.mcp.json`
  (Claude Code) and `.cursor/mcp.json` (Cursor), merged into existing files, so everyone who opens
  the repo is offered the server (`--no-mcp` to skip)
- Optional `release-guardian.config.json` for product areas and critical areas
- Playwright reporter writes `artifacts/run-summary.json` (test totals by final outcome)
- Programmatic API: `analyzeRelease`, `classifyFailure`, `attributeFailure`, `groupFailures`,
  `scoreRisk`, `decideRelease`, `collectChanges`, `formatReleaseComment`, `readRunSummary`,
  `inferFailureType`, `formatDiffSections` and types
- `RELEASE_GUARDIAN_TEARDOWN_LOGS` alias for `QA_INTELLIGENCE_TEARDOWN_LOGS`

### Changed

- `computeDiff` no longer needs AI output: when a failed attempt has `meta.json` but no `ai.txt`,
  the failure type is inferred from the Playwright error. Failures now carry `title`, `errorMessage`,
  `project`, `retry`, `url` and `source` (`ai` | `heuristic`)
- Scaffolded workflow: `fetch-depth: 0`; diff, history and comment run without an AI key; the
  guardian owns the gate (`--fail-on review`) and `qa-intelligence-diff` runs with
  `--fail-on-blocking false`; adds a job summary and a release-report artifact
- `qa-intelligence-comment` and the guardian update an existing bot comment under either header,
  and look past the first 100 PR comments
- One `Failure` type in `src/lib/types.ts`; `EnrichedFailure` and the `Failure` export of
  `computeDiff` are now aliases of it

### Fixed

- Default Anthropic model `claude-3-5-haiku-latest` was retired and returned 404, so Anthropic users
  without `AI_MODEL` silently got no AI analysis. Default is now `claude-haiku-5-5`, and the cost
  table has current prices (Opus 4.6 to 4.8 were listed at $15 / $75, now $5 / $25)
- An empty key variable (e.g. `OPENAI_API_KEY=""`, which is how GitHub renders a missing secret)
  failed config validation and disabled AI even when `ANTHROPIC_API_KEY` was set. Empty values now
  count as unset, and without `AI_PROVIDER` the provider is picked from whichever key exists
- Scaffolded workflow passes `ANTHROPIC_API_KEY` and the `AI_PROVIDER` / `AI_MODEL` repo variables,
  and enables AI analysis when either key is present
- `qa-intelligence-history` dropped `blockingFailures` and any extra fields when rewriting
  `failure-diff.json`
- Scaffolded workflow: merge-time reuse downloaded an artifact name the PR run never uploads
  (`ai-failure-artifacts`), so it always re-ran the suite
- VS Code Playwright extension showed "test server connection closed" when the repo root was open.
  Two causes, both when Playwright starts from the repo root: `qa-intelligence/config/env` only read
  `.env` from the current folder and called `process.exit(1)` when `BASE_URL` was missing, and
  `@playwright/test` was resolved only from the current folder. `.env` is now also read from the
  Playwright config's folder and `playwright/` (override with `RELEASE_GUARDIAN_ENV_FILE`), a missing
  variable throws a readable error, and Playwright is resolved from the running CLI first
- `.env.example` shows the Anthropic setup with `claude-haiku-5-5` and that the provider is picked
  from whichever key is set
- **Security:** the npm package now lists the exact template files `init` copies instead of the
  whole `templates/` folder. Before, any local file there was published, including
  `templates/playwright/.env`: versions 1.4.6 to 1.5.2 shipped a `.env` (1.5.1 and 1.5.2 with a real
  API key, which has to be revoked) and thousands of `node_modules` files. CI now fails if the
  package would contain a `.env`, `node_modules`, test output or anything that looks like an API key
- `npm test` glob is quoted so `src/index.test.ts` and nested test files actually run
- **Failures went unrecorded:** the failure hook was a module-level `test.afterEach`, which
  Playwright attaches only to the first spec file that imports it in each worker. A failure in any
  later file of the same worker wrote no `meta.json`, so the diff and verdict missed it (with
  retries, only the retry in a fresh worker was recorded). The hook is now an auto fixture that runs
  for every test, covered by a test that runs real Playwright
- Local runs pile up as `artifacts/run-<time>/` folders; the diff read all of them, so a failure
  fixed since an earlier run was still reported. When `artifacts/.current-run` is present only that
  run is read (downloaded CI artifacts have no marker, so merged shards are still read whole)
- A test that is flaky on main and on the PR is listed as "flaky on main too", not "still failing
  from main"
- MCP `analyze_local`: says so when only part of the suite ran (and doesn't call the skipped tests
  fixed), refuses to judge a run that was stopped before it finished, and finds results at the repo
  root when Playwright ran from there (VS Code extension with the `init` layout)
- MCP `get_pr_verdict`: tells "CI still running" apart from "CI ran but made no guardian report"
  (no baseline on main yet), explains a token that can't see the repo instead of GitHub's bare
  "Not Found", and with several `gh` accounts signed in uses the one named like the repo owner
- Test files are type-checked: `tsconfig.json` covers them (editors no longer flag `node:` imports),
  the package builds from `tsconfig.build.json`, and CI runs `npm run typecheck`
- `init` no longer says `AI_PROVIDER=anthropic` is needed with an Anthropic key

## 1.5.3

### Fixed

- AI failure JSON parsing now tolerates a trailing ` ```json ` markdown fence (or any trailing text)
  around SECTION 2 - some providers (notably Claude/Anthropic) wrap it despite the prompt saying not
  to, which previously broke `JSON.parse` and silently dropped the failure from the diff

### Added (scaffolded CI template)

- `concurrency` guard - cancels superseded PR runs only, never a push/merge run mid-flight, so a
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

- AI cost rollup and "Saved AI summary: ..." line printed at the very end of the terminal output, after Playwright's own list-reporter summary and HTML report note - previously `globalTeardown` logged them before tests finished reporting, so they appeared above failure stack traces instead of at the bottom

### Added

- `qa-intelligence/playwright/reporter` - official Playwright reporter (`AiSummaryReporter`); register it last in `playwright.config.ts` to print the rollup after all other reporters
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

- **Flaky Watchlist** in PR comments - tests intermittent across recent PR CI runs (from `.cache/failure-history.json`)
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

- `npx qa-intelligence init` - scaffolds `playwright/` and `.github/workflows/qa-intelligence.yml`
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

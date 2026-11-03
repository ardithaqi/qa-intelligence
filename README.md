# AI Release Guardian

**npm:** [`qa-intelligence`](https://www.npmjs.com/package/qa-intelligence) · formerly *QA Intelligence*

A release-quality agent for Playwright CI. It watches each PR's test results and answers the question a reviewer actually has: **is this safe to merge?**

For every failure it works out whether it's a **real regression**, **flaky**, an **infrastructure** problem or a **broken test**. It then groups failures that share a cause, points at the **changed file and commit** most likely responsible, scores **release risk**, and ends with one decision: **SAFE TO MERGE**, **REVIEW REQUIRED** or **BLOCK**.

The PR comment stays short no matter how many tests fail. You get one line per **problem**, not per test, and each line expands to show the tests (linked to the exact line), the likely cause (file and commit) and the error:

```text
## AI Release Guardian
┃ Caution
┃ BLOCK · CRITICAL risk (100/100)
┃ 3 new regressions in Authentication, Profile, Checkout. Likely cause: src/auth/session.ts (commit 82fa7d0).
248 tests · 5 new failures · 1 still failing from main · 1 fixed · CI run

▸ Regression · 3 tests · expected "dashboard", got "login" · likely cause src/auth/session.ts
▸ Infrastructure · report.spec.ts:5 · can't reach server (ERR_CONNECTION_REFUSED)
▸ Flaky · search.spec.ts:5 · failed, then passed on retry
▸ More: still failing (1), fixed (1), score
```

The verdict sits in a GitHub alert box: red for BLOCK, purple for REVIEW REQUIRED, and yellow for SAFE TO MERGE when flaky or infrastructure failures happened (you can merge, but something wobbled). A clean PR is just "SAFE TO MERGE" with no box.

Up to 10 problem lines are shown, and anything beyond that sits behind "…and N more". Failures with the same cause (the same changed file, or the exact same error) share one line.

Every number has a reason, one click away: each problem shows why it was classified that way, and the score breakdown sits under **More**. Classification, scoring and the decision are **deterministic code**. AI analysis is optional extra evidence and never the verdict.

Still included from QA Intelligence: AI failure analysis, PR failure diff (new / flaky / still failing / fixed), retry-aware flaky detection, recurrence tracking and the Flaky Watchlist.

Install it into your existing app repo, or start from the [framework template](https://github.com/ardithaqi/qa-intelligence-framework).

---

## Quick start

Run from your **repo root** (not inside `playwright/`). You do **not** need a `playwright/` folder beforehand - `init` creates it.

```bash
npx qa-intelligence init
cd playwright
cp .env.example .env   # set BASE_URL
npm install            # installs qa-intelligence + @playwright/test (see playwright/package.json)
npx playwright install
```

For **local runs with AI failure analysis** (generates per-failure `ai.txt` plus a run-level `ai-summary.md`), add to `playwright/.env`. This is optional: without it, failures are classified from Playwright's error output.

```bash
AI_ANALYSIS=true
OPENAI_API_KEY=sk-...
```

CI sets `AI_ANALYSIS=true` in the workflow; locally you must enable it yourself. The `qa-intelligence/playwright/reporter` entry in `playwright.config.ts` prints one combined cost rollup line - and the path to the saved `ai-summary.md` - after Playwright's own pass/fail summary, so it's the last thing in the terminal instead of getting buried above the failure output. Set `RELEASE_GUARDIAN_TEARDOWN_LOGS=true` (or the older `QA_INTELLIGENCE_TEARDOWN_LOGS`) if you also want teardown's per-failure "Analyzing"/"Saved AI analysis" lines (off by default).

### AI providers

If `AI_PROVIDER` isn't set, the provider comes from whichever key exists: **OpenAI** (`gpt-4o-mini`) if `OPENAI_API_KEY` is set, otherwise **Anthropic** (`claude-haiku-5-5`) if `ANTHROPIC_API_KEY` is set. Empty values count as unset, so a missing GitHub secret doesn't break anything. Configure via env:

| Variable | Purpose |
|----------|---------|
| `AI_PROVIDER` | `openai`, `anthropic`, or `openai-compatible` (picked from the keys when unset) |
| `AI_MODEL` | Model name (provider-specific default if unset) |
| `OPENAI_API_KEY` | API key for OpenAI (or fallback for `openai-compatible`) |
| `ANTHROPIC_API_KEY` | API key for Anthropic |
| `AI_API_KEY` | Generic key fallback for any provider |
| `AI_BASE_URL` | Required for `openai-compatible` (Azure OpenAI, Ollama, LiteLLM, etc.) |

Examples:

```bash
# OpenAI (default)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini

# Anthropic
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-haiku-5-5

# OpenAI-compatible (Ollama, Azure, etc.)
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1
AI_API_KEY=ollama
AI_MODEL=llama3
```

Everything else (diff, classification, grouping, risk, decision) works **without AI**. With no API key set, AI analysis is skipped and failures are classified from Playwright's error output.

**What AI adds.** One small call per failed test (about $0.0005 to $0.001 with `claude-haiku-5-5`). The AI's failure type and confidence become one more piece of evidence: when it agrees with the rules, confidence goes up a few points and the comment says "AI analysis agrees". It never overrides the rules. A strict-mode locator stays a broken test and a refused connection stays infrastructure even if the AI labels them differently, and a bare timeout stays "Unclear" however confident the AI is.

In CI, add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` as a repo secret. The scaffolded workflow passes both, plus the optional `AI_PROVIDER` / `AI_MODEL` repo variables.

`init` scaffolds:

- `playwright/` - `.env.example`, `.gitignore`, `package.json`, `tsconfig.json`, `playwright.config.ts`, example test
- `.github/workflows/qa-intelligence.yml` - runs tests, assesses the PR, gates the merge and comments (skip with `--no-ci`)

**Then:** set `BASE_URL` in the workflow file. Optionally add `OPENAI_API_KEY` to GitHub secrets for AI analysis.

**Tests** - always import from the package, not Playwright directly:

```ts
import { test, expect } from "qa-intelligence/playwright";
```

### `init` options

By default, `init` skips any file that already exists so it won't overwrite your work.

| Flag | What it does |
|------|----------------|
| `--no-ci` | Only scaffold `playwright/` (config, env, tests). Does **not** create `.github/workflows/qa-intelligence.yml`. Use this if you already have CI or use GitLab/Jenkins. |
| `--force` | Overwrite existing scaffold files. Use when re-running `init` and you want a fresh copy from the templates. |

```bash
npx qa-intelligence init              # playwright/ + GitHub workflow
npx qa-intelligence init --no-ci      # playwright/ only
npx qa-intelligence init --force      # overwrite files that already exist
```

---

## How decisions are made

### 1. Classification

Each failure gets one category, a confidence (0–100) and the evidence behind it. Rules run in this order:

| Category | Evidence |
|----------|----------|
| `flaky` | Failed, then passed on retry in this run. Confidence goes up when history shows the same test flipping between pass and fail. |
| `infrastructure` | Network, DNS, browser-launch or gateway errors (`ECONNREFUSED`, `net::ERR_…`, `502 Bad Gateway`, …), or AI said `environment_error`. |
| `test_issue` | The test code is broken (`strict mode violation`, `SyntaxError`, missing fixture), or only the test file changed and its locator stopped matching. |
| `regression` | New on this PR, failed every retry, and the error is an assertion, missing element or navigation failure. Confidence goes up with a related code change and AI agreement, and down with no retries or a flaky history. |
| `unknown` | Not enough evidence, e.g. a plain timeout with no related change. |

Failures already failing on the base branch are labelled **pre-existing**. They show up in the comment but never add risk or block.

### 2. Root-cause grouping and attribution

The guardian reads `git diff base...HEAD` and the latest commit that touched each changed file. It links a failure to a changed file:

- **in the error output** (80%), or
- **by shared words and product area** between the test's path, title and URL and the changed path, e.g. `checkout.spec.ts › cart total` and `src/checkout/cartTotal.ts` (35–70%), or
- **the failing test file itself** changed (50%, which suggests a test issue).

E2E stack traces rarely contain app files, so naming overlap is the main signal. Confidence is capped accordingly, and nothing is reported below 35%. Failures pointing at the same changed file form one group. Several independent suites agreeing adds confidence. Otherwise, failures with the same normalized error message are grouped together.

### 3. Risk score (0–100)

Additive and capped. Only failures **new on this PR** count:

| Factor | Points |
|--------|--------|
| First new regression | +40 |
| Each additional regression | +15 (regressions max 70) |
| Regression in a critical area (Authentication, Checkout, Payment, Security) | +20 |
| Each extra affected area | +5 (max 10) |
| Root cause uncertain (best group < 50%) | +5 |
| Unknown failure | +10 each (max 20) |
| Test issue | +5 each (max 10) |
| Infrastructure failure | +5 each (max 15) |
| Flaky failure | +2 each (max 6) |

**0–29 LOW · 30–59 MEDIUM · 60–79 HIGH · 80–100 CRITICAL**

### 4. Decision

| Decision | When |
|----------|------|
| **BLOCK** | A new regression with ≥ 70% confidence, or any new regression while risk is HIGH/CRITICAL |
| **REVIEW REQUIRED** | Low-confidence regression, unknown failure, broken test, infrastructure failures in ≥ 5 tests or > 20% of the suite (rerun), or risk ≥ MEDIUM |
| **SAFE TO MERGE** | Nothing new, or only flaky / infrastructure / pre-existing failures |

### Merge gate

`ai-release-guardian analyze --fail-on <policy>` sets the CI exit code:

| `--fail-on` | Fails the job on |
|-------------|------------------|
| `review` (scaffold default) | BLOCK and REVIEW REQUIRED |
| `block` | BLOCK only |
| `never` | Nothing (report only) |

Also settable with `RELEASE_GUARDIAN_FAIL_ON`. The older `qa-intelligence-diff` gate (fail on any new non-flaky failure) still works the same way. The scaffold turns it off with `--fail-on-blocking false` so the guardian owns the decision.

### Configuration

Optional `release-guardian.config.json` next to where you run the CLI (`playwright/` in the scaffold):

```json
{
  "areas": {
    "Onboarding": ["onboarding", "welcome", "invite"],
    "Checkout": ["checkout", "cart", "basket"]
  },
  "criticalAreas": ["Authentication", "Checkout", "Payment", "Security", "Onboarding"]
}
```

`areas` merges over the defaults (same name replaces); `criticalAreas` replaces the default list.

### Run totals

`Tests analyzed` comes from `artifacts/run-summary.json`, which the `qa-intelligence/playwright/reporter` entry writes. The scaffolded `playwright.config.ts` already includes it.

---

## Failure diff (from QA Intelligence)

The detailed failure diff is still in the comment, under **Failure diff vs base branch**:

| Section | Meaning |
|---------|---------|
| New Issues | Failing now, not on base branch (not flaky) |
| Flaky | Failed then passed on retry |
| Still Failing | Already failing on base branch |
| Fixed Issues | Failing on base branch, passing now |
| Flaky Watchlist | Intermittent across recent CI runs |

**Flaky Watchlist** uses the history cache (last 20 PR runs, repo-wide). A test appears when it showed up in the failure report on at least 2 runs but not every run. Tests already listed as **New Issues** or **Still Failing** on this PR are omitted. The same history also feeds the guardian's flaky classification.

### Failure history in CI

Recurrence (`3rd time since…`), the **Flaky Watchlist** and history-based flaky detection need `.cache/failure-history.json` to survive between runs. The `init` workflow caches `playwright/.cache` with a per-run key plus a repo-scoped `restore-keys` prefix:

```yaml
- uses: actions/cache@v4
  with:
    path: playwright/.cache
    key: failure-history-${{ github.repository }}-${{ github.run_id }}
    restore-keys: |
      failure-history-${{ github.repository }}-
```

A key that never changes restores fine, but `actions/cache` won't save over an exact hit, so history stops growing. A per-commit SHA key never restores at all. If you scaffolded CI before 1.5.3, update your workflow or re-run `npx qa-intelligence init --force`.

---

## CLI

| Command | Purpose |
|---------|---------|
| `ai-release-guardian analyze` | Classify, group, attribute, score and decide; writes `release-report.json` + `release-guardian.md`; exit code per `--fail-on` |
| `ai-release-guardian comment` | Post/update the PR comment from `release-report.json` |
| `ai-release-guardian init` | Same as `qa-intelligence init` |
| `qa-intelligence init` | Scaffold project files |
| `qa-intelligence-diff` | Compare baseline vs current failures → `failure-diff.json` |
| `qa-intelligence-history` | Recurrence tracking |
| `qa-intelligence-comment` | Post/update the legacy failure-diff comment |

Run `npx ai-release-guardian --help` for all options. A typical PR pipeline:

```bash
npx qa-intelligence-diff --baseline ../baseline-artifacts --current artifacts --fail-on-blocking false
npx qa-intelligence-history
npx ai-release-guardian analyze --base "$BASE_SHA" --fail-on review
npx ai-release-guardian comment --repo owner/repo --pr 123   # uses $GITHUB_TOKEN
```

`--base` needs full git history (`actions/checkout` with `fetch-depth: 0`). Without it, attribution is skipped and the comment says so.

### Upgrading from QA Intelligence 1.x

Nothing breaks: same package name, imports, commands and output files. To get the guardian, re-run `npx qa-intelligence init --force` (it overwrites the scaffold files, so back up any local edits), or add the `analyze` and `comment` steps above to your workflow. The guardian updates the existing PR comment in place, whether it has the old or the new header.

---

## Package exports

| Import | What you get |
|--------|--------------|
| `qa-intelligence` | `analyzeRelease`, `formatReleaseComment`, `collectChanges`, `computeDiff`, `formatDiffComment`, `enrichDiffWithHistory`, history helpers, types |
| `qa-intelligence/playwright` | `test`, `expect`, `env` |
| `qa-intelligence/playwright/globalSetup` | Artifact run setup |
| `qa-intelligence/playwright/globalTeardown` | AI failure analysis |
| `qa-intelligence/playwright/reporter` | Writes `artifacts/run-summary.json` (test totals) and prints the AI cost rollup last |
| `qa-intelligence/playwright/basePage` | Base page object |
| `qa-intelligence/playwright/steps` | `step()` helper |
| `qa-intelligence/config/env` | Validated env config |

### Programmatic API

Use the same functions as the CLIs in custom CI scripts (GitLab, Jenkins, Slack bots, etc.):

```ts
import {
  computeDiff,
  enrichDiffWithHistory,
  formatDiffComment,
} from "qa-intelligence";

const diff = computeDiff("baseline-artifacts", "artifacts");
const enriched = enrichDiffWithHistory(diff, ".cache/failure-history.json", {
  sha: process.env.CI_COMMIT_SHA,
});
const comment = formatDiffComment(enriched);
```

Release assessment from any CI (GitLab, Jenkins, …):

```ts
import { analyzeRelease, collectChanges, formatReleaseComment, readRunSummary } from "qa-intelligence";

const report = analyzeRelease(enriched, {
  changes: collectChanges(process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA),
  runSummary: readRunSummary("artifacts"),
});

console.log(report.decision, report.risk.score, report.primaryGroup?.rootCause);
const markdown = formatReleaseComment(report, enriched);
```

The building blocks (`classifyFailure`, `attributeFailure`, `groupFailures`, `scoreRisk`, `decideRelease`) are exported too. All of it works without AI keys.

---

## Full template (optional)

Prefer a ready-made project with Docker, example tests, and CI pre-wired? Use the **[qa-intelligence-framework](https://github.com/ardithaqi/qa-intelligence-framework)** template - click "Use this template".

For adding to an existing repo with a `playwright/` subfolder, see the [framework adoption guide](https://github.com/ardithaqi/qa-intelligence-framework#add-to-an-existing-project-npm-package) (`Dockerfile`, CI path changes).

---

## Recipes

The scaffolded workflow already reuses a merged PR's results on push instead of re-running the suite,
and runs AI analysis only when an API key is configured. For patterns that are too
project-specific to default to - like splitting a monorepo's suite by which app changed - see
[`docs/recipes.md`](docs/recipes.md).

---

## License

MIT

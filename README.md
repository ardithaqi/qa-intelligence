# qa-intelligence

CI intelligence engine for Playwright test pipelines.

- AI-powered failure analysis
- PR failure diff (new, flaky, still failing, fixed)
- Flaky test detection (retry-aware)
- PR blocking on new non-flaky failures
- Recurrence tracking ("3rd time since...")

Use it **without the framework template** — install the package into any existing Playwright project.

---

## Install

```bash
npm install qa-intelligence @playwright/test
```

---

## Quick setup (existing project)

### 1. Environment (`.env`)

```env
BASE_URL=https://your-app.example.com
HEADLESS=true
PW_WORKERS=2
PW_RETRIES=1
```

### 2. `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";
import { env } from "qa-intelligence/config/env";

export default defineConfig({
  testDir: "./tests",
  retries: env.PW_RETRIES,
  workers: env.PW_WORKERS,
  globalSetup: require.resolve("qa-intelligence/playwright/globalSetup"),
  globalTeardown: require.resolve("qa-intelligence/playwright/globalTeardown"),
  use: {
    baseURL: env.BASE_URL,
    headless: env.HEADLESS,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
```

### 3. Write tests

Always import `test` from the package — **not** directly from Playwright:

```ts
import { test, expect } from "qa-intelligence/playwright";

test("user can login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/My App/);
});
```

Optional helpers:

```ts
import { step } from "qa-intelligence/playwright/steps";
import { BasePage } from "qa-intelligence/playwright/basePage";
```

### 4. What you provide

| You write | Package provides |
|-----------|------------------|
| `tests/` | Test hooks, artifact capture |
| `.env` | Env validation |
| `playwright.config.ts` | `globalSetup`, `globalTeardown`, AI teardown |
| `.github/workflows/ci.yml` | `qa-intelligence-diff`, `qa-intelligence-history`, `qa-intelligence-comment` |
| Page objects (optional) | `BasePage`, `step()` |

---

## CI setup (GitHub Actions)

### Option A: Copy the full workflow (recommended)

Copy `.github/workflows/ci.yml` from the [framework template](https://github.com/ardithaqi/qa-intelligence-framework/blob/master/.github/workflows/ci.yml) into your repo.

It includes everything wired together:

- Docker test execution
- Artifact upload on every run
- Baseline download from `main` on pull requests
- `qa-intelligence-diff`, `qa-intelligence-history`, `qa-intelligence-comment`
- PR blocking on new non-flaky failures

Then update:

- `BASE_URL` in the `docker run` step
- GitHub secrets (see below)

### Option B: Add to your existing workflow

If you already run Playwright in CI, add these steps **after** tests run and `artifacts/` are uploaded:

```bash
npm install qa-intelligence
npx qa-intelligence-diff --baseline baseline-artifacts --current artifacts
npx qa-intelligence-history
npx qa-intelligence-comment \
  --diff failure-diff.json \
  --repo owner/repo \
  --pr 123 \
  --token $GITHUB_TOKEN
```

You must also handle on your own:

- Uploading `artifacts/` after each run
- Downloading `baseline-artifacts/` from the target branch on PRs

See the [framework CI workflow](https://github.com/ardithaqi/qa-intelligence-framework/blob/master/.github/workflows/ci.yml) for reference.

### Required GitHub secrets

- `OPENAI_API_KEY` — enables AI failure analysis in teardown
- `TEST_USERNAME` / `TEST_PASSWORD` — if your tests need credentials

Set `AI_ANALYSIS=true` in CI when running tests inside Docker.

---

## PR behavior

| Failure type | Blocks PR? | Shown in comment |
|--------------|------------|------------------|
| New (not flaky) | Yes | New Issues |
| Flaky | No | Flaky |
| Still failing from base branch | No | Still Failing |
| Fixed since base branch | No | Fixed Issues |

---

## CLI tools

| Command | Purpose |
|---------|---------|
| `qa-intelligence-diff` | Compare baseline vs current failures |
| `qa-intelligence-history` | Add recurrence tracking |
| `qa-intelligence-comment` | Post/update PR summary comment |

---

## Package exports

| Import path | What it gives you |
|-------------|-------------------|
| `qa-intelligence/playwright` | `test`, `expect`, `env` |
| `qa-intelligence/playwright/globalSetup` | Artifact run setup |
| `qa-intelligence/playwright/globalTeardown` | AI failure analysis |
| `qa-intelligence/playwright/basePage` | Base page object |
| `qa-intelligence/playwright/steps` | `step()` helper |
| `qa-intelligence/config/env` | Validated env config |

---

## Alternative: use the full template

If you prefer a ready-made project with examples, Docker, and CI pre-wired:

**[qa-intelligence-framework](https://github.com/ardithaqi/qa-intelligence-framework)** — click "Use this template".

The template uses this package under the hood.

---

## Author

Built as the intelligence engine behind QA automation — Playwright hooks, AI failure analysis, and PR-aware CI. If you use this package, consider leaving a star or linking back—contributions are welcome.

---

## License

MIT

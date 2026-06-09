# QA Intelligence

**npm:** [`qa-intelligence`](https://www.npmjs.com/package/qa-intelligence)

The intelligence engine for Playwright CI pipelines — install it into any project or use the full [QA Intelligence Framework](https://github.com/ardithaqi/qa-intelligence-framework) template.

- AI-powered failure analysis
- PR failure diff (new, flaky, still failing, fixed)
- Flaky test detection (retry-aware)
- PR blocking on new non-flaky failures
- Recurrence tracking ("3rd time since...")

Use it **without the framework template** — install the package into your existing app repo.

**Recommended layout:** create a `playwright/` subfolder at the repo root and keep all E2E tooling there, separate from your main app code. Full step-by-step guide (folder layout, `Dockerfile`, CI path changes): **[qa-intelligence-framework README](https://github.com/ardithaqi/qa-intelligence-framework#add-to-an-existing-project-npm-package)**.

---

## Install

Run inside your `playwright/` folder (or your Playwright project root if tests already live there):

```bash
cd playwright
npm install qa-intelligence @playwright/test
```

npm automatically installs peer dependencies (`typescript`, `@types/node`) — no separate dev-deps step needed.

---

## Setup

All paths below are relative to `playwright/` when using the recommended subfolder layout.

### 1. Environment (`.env`)

```env
BASE_URL=https://your-app.example.com
HEADLESS=true
PW_WORKERS=2
PW_RETRIES=1
```

### 2. `tsconfig.json` (TypeScript projects)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["tests/**/*", "playwright.config.ts"]
}
```

> `module` and `moduleResolution` must both be `"Node16"` so TypeScript resolves the package `exports` map.

### 3. `playwright.config.ts`

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

### 4. Write tests

**Important** — always import `test` and `expect` from the package:

```ts
import { test, expect } from "qa-intelligence/playwright";
```

**Not** directly from Playwright:

```ts
// ❌ No AI artifacts, no PR diff, no flaky detection
import { test, expect } from "@playwright/test";
```

Using `qa-intelligence/playwright` enables:

- AI failure analysis (`meta.json` → `ai.txt`)
- Artifact generation on failure
- Flaky detection (retry-aware)
- CI diff intelligence and PR comments

Example test:

```ts
import { test, expect } from "qa-intelligence/playwright";

test("user can login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/My App/);
});
```

> **Using the [framework template](https://github.com/ardithaqi/qa-intelligence-framework)?** Import from local `src/core/baseTest` instead — same hooks, different path for that repo layout.

Optional helpers:

```ts
import { step } from "qa-intelligence/playwright/steps";
import { BasePage } from "qa-intelligence/playwright/basePage";
```

### 5. What you provide

| You write | Package provides |
|-----------|------------------|
| `playwright/tests/` | Test hooks, artifact capture |
| `playwright/.env` | Env validation |
| `playwright/playwright.config.ts` | `globalSetup`, `globalTeardown`, AI teardown |
| `playwright/Dockerfile` | — (copy from [framework](https://github.com/ardithaqi/qa-intelligence-framework/blob/master/Dockerfile)) |
| `.github/workflows/ci.yml` | `qa-intelligence-diff`, `qa-intelligence-history`, `qa-intelligence-comment` |
| Page objects (optional) | `BasePage`, `step()` |

---

## CI setup (GitHub Actions)

Copy [`.github/workflows/ci.yml`](https://github.com/ardithaqi/qa-intelligence-framework/blob/master/.github/workflows/ci.yml) and [`Dockerfile`](https://github.com/ardithaqi/qa-intelligence-framework/blob/master/Dockerfile) from the framework repo.

When using the `playwright/` subfolder layout, apply the CI path changes documented in the [framework adoption guide](https://github.com/ardithaqi/qa-intelligence-framework#add-to-an-existing-project-npm-package) (`working-directory: playwright`, artifact paths, etc.).

The workflow includes:

- Docker test execution
- Artifact upload on every run
- Baseline download from `main` on pull requests
- `qa-intelligence-diff`, `qa-intelligence-history`, `qa-intelligence-comment`
- PR blocking on new non-flaky failures

Then update:

- `BASE_URL` in the `docker run` step
- GitHub secrets (see below)

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

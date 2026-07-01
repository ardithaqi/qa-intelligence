# QA Intelligence

**npm:** [`qa-intelligence`](https://www.npmjs.com/package/qa-intelligence)

The intelligence engine for Playwright CI pipelines — install it into any project or use the full [QA Intelligence Framework](https://github.com/ardithaqi/qa-intelligence-framework) template.

- AI-powered failure analysis
- PR failure diff (new, flaky, still failing, fixed)
- Flaky test detection (retry-aware)
- PR blocking on new non-flaky failures
- Recurrence tracking ("3rd time since...")

Use it **without the framework template** — install the package into your existing app repo.


---

## Quick start

Run from your **repo root** (not inside `playwright/`). You do **not** need a `playwright/` folder beforehand — `init` creates it.

```bash
npx qa-intelligence init
cd playwright
cp .env.example .env   # set BASE_URL
npm install            # installs qa-intelligence + @playwright/test (see playwright/package.json)
npx playwright install
```

`init` scaffolds:

- `playwright/` — `.env.example`, `package.json`, `tsconfig.json`, `playwright.config.ts`, example test
- `.github/workflows/qa-intelligence.yml` — PR diff, history, and comment (skip with `--no-ci`)

**Then:** add `OPENAI_API_KEY` to GitHub secrets and set `BASE_URL` in the workflow file.

**Tests** — always import from the package, not Playwright directly:

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

## PR behavior

| Failure type | Blocks PR? | Shown in comment |
|--------------|------------|------------------|
| New (not flaky) | Yes | New Issues |
| Flaky | No | Flaky |
| Still failing from base branch | No | Still Failing |
| Fixed since base branch | No | Fixed Issues |

---

## CLI

| Command | Purpose |
|---------|---------|
| `qa-intelligence init` | Scaffold project files |
| `qa-intelligence-diff` | Compare baseline vs current failures |
| `qa-intelligence-history` | Recurrence tracking |
| `qa-intelligence-comment` | Post/update PR summary |

---

## Package exports

| Import | What you get |
|--------|--------------|
| `qa-intelligence/playwright` | `test`, `expect`, `env` |
| `qa-intelligence/playwright/globalSetup` | Artifact run setup |
| `qa-intelligence/playwright/globalTeardown` | AI failure analysis |
| `qa-intelligence/playwright/basePage` | Base page object |
| `qa-intelligence/playwright/steps` | `step()` helper |
| `qa-intelligence/config/env` | Validated env config |

---

## Full template (optional)

Prefer a ready-made project with Docker, example tests, and CI pre-wired? Use the **[qa-intelligence-framework](https://github.com/ardithaqi/qa-intelligence-framework)** template — click "Use this template".

For adding to an existing repo with a `playwright/` subfolder, see the [framework adoption guide](https://github.com/ardithaqi/qa-intelligence-framework#add-to-an-existing-project-npm-package) (`Dockerfile`, CI path changes).

---

## License

MIT

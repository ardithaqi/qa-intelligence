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

For **local runs with AI failure analysis** (generates `ai.txt` in artifacts — needed for `qa-intelligence-diff`), add to `playwright/.env`:

```bash
AI_ANALYSIS=true
OPENAI_API_KEY=sk-...
```

CI sets `AI_ANALYSIS=true` in the workflow; locally you must enable it yourself.

### AI providers

Default provider is **OpenAI** (`gpt-4o-mini`). Configure via env:

| Variable | Purpose |
|----------|---------|
| `AI_PROVIDER` | `openai` (default), `anthropic`, or `openai-compatible` |
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
AI_MODEL=claude-3-5-haiku-latest

# OpenAI-compatible (Ollama, Azure, etc.)
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1
AI_API_KEY=ollama
AI_MODEL=llama3
```

Diff, flaky detection, and PR blocking work **without AI** — analysis is skipped when no API key is set.

`init` scaffolds:

- `playwright/` — `.env.example`, `.gitignore`, `package.json`, `tsconfig.json`, `playwright.config.ts`, example test
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

# QA Intelligence — Agent Guide

This file orients AI agents working on **qa-intelligence** (`qa-ci-intelligence` repo). Read it before planning features, refactors, or docs.

## Project summary

**qa-intelligence** is the CI intelligence engine for Playwright pipelines. It is published to npm and consumed standalone or via the [qa-intelligence-framework](https://github.com/ardithaqi/qa-intelligence-framework) template.

Core capabilities:

- AI-powered failure analysis (Playwright hooks → `meta.json` → `ai.txt`)
- PR failure diff: new, flaky, still failing, fixed
- Flaky test detection (retry-aware)
- PR blocking on new non-flaky failures
- Recurrence tracking ("3rd time since…")

### Key paths

| Area | Location |
|------|----------|
| Playwright hooks | `src/playwright/` |
| AI analysis | `src/ai/failureAnalyzer.ts`, `src/ai/getProvider.ts`, `src/ai/providers/` |
| Diff engine | `src/lib/computeDiff.ts`, `src/lib/failureIdentity.ts` |
| PR comment formatting | `src/lib/format.ts` |
| Programmatic API | `src/index.ts` — `computeDiff`, `formatDiffComment`, history helpers |
| CLI tools | `src/cli/` (`init`, `diff`, `history`, `postComment`) |
| Init templates | `templates/` |
| Env validation | `src/config/env.ts` |

### CLI commands

- `qa-intelligence init` — scaffold `playwright/` + `.github/workflows/qa-intelligence.yml` from `templates/`
- `qa-intelligence-diff` — compare baseline vs current failures
- `qa-intelligence-history` — enrich diff with recurrence; persists `.cache/failure-history.json`
- `qa-intelligence-comment` — post/update GitHub PR summary comment

### Publishing to npm

Before each release, update in order:

1. **`package.json`** — bump `version` (semver)
2. **`CHANGELOG.md`** — move/add entry under the new version (not "Unreleased" only)
3. **`README.md`** — if user-facing setup or CLI behavior changed
4. **`AGENTS.md`** — if architecture, paths, or agent conventions changed
5. **`templates/`** — if scaffold defaults changed (e.g. workflow, `playwright/package.json` version pin)

Then: `npm test` → `npm run build` → `git commit` → `git push` → `npm publish`.

Only `dist/` and `templates/` ship to npm (`files` in `package.json`). GitHub workflow in *this* repo (`.github/workflows/ci.yml`) is maintainer CI only.

### Conventions

- Match existing TypeScript style: strict types, minimal abstraction, focused diffs
- `Failure` types are duplicated today — prefer centralizing in `src/lib/types.ts` when touching related code
- Users must import `test` / `expect` from `qa-intelligence/playwright`, not `@playwright/test` directly
- Package ships compiled `dist/` only; run `npm run build` after source changes
- Do not commit secrets (`.env`, API keys)

---

## Elevation roadmap (prioritized tiers)

Work top-down unless the user scopes a specific tier or item.

### Tier 1 — High impact (do first)

1. **Unit tests for the package**
   - No tests exist today — highest credibility gap for a PR-blocking tool
   - Start with pure unit tests (no Playwright runtime):
     - `computeDiff` — new / unchanged / fixed / blocking classification
     - `failureIdentity` — path normalization, stack parsing, diff keys
     - `format` — PR comment output, recurrence suffixes
     - `history` — occurrence counts, cache rotation (`MAX_RUNS`)

2. **CI for this repo**
   - Add `.github/workflows/` — `npm test`, `npm run build` on PR
   - Optional: run CLI against fixture artifact directories
   - Dogfood the diff engine on this repo's PRs

3. **First-party GitHub Action**
   - Replace manual 3-CLI workflow wiring with a single action, e.g.:
     ```yaml
     - uses: ardithaqi/qa-intelligence-action@v1
       with:
         openai-api-key: ${{ secrets.OPENAI_API_KEY }}
         block-on-new-failures: true
     ```
   - May live in this repo or a sibling `qa-intelligence-action` repo

4. **README that sells the outcome**
   - PR comment screenshot, short demo GIF
   - "Why not Playwright's built-in reporter?" section
   - Keep setup docs; add visible proof of value

### Tier 2 — Differentiation & depth

5. **Pluggable AI providers**
   - Abstract OpenAI behind a provider interface
   - Support env-driven provider/model (`AI_PROVIDER`, `AI_MODEL`)
   - Graceful degradation: diff / flaky / blocking without AI

6. **Richer flaky detection** ✅ (watchlist)
   - Flaky Watchlist in PR comments from history cache pass/fail flip rate per test file
   - Retry-aware single-run flaky detection unchanged (`Flaky` section)

7. **Programmatic API exports**
   - Export core from package entry, e.g. `computeDiff`, `formatDiffComment`
   - Enables GitLab, CircleCI, Jenkins, Slack bots without forking

8. **Persistent history in CI**
   - Document or automate `actions/cache` for `.cache/failure-history.json`
   - Optional S3/GCS persistence for recurrence tracking across runs

### Tier 3 — Reach & ecosystem

9. **Beyond GitHub**
   - GitLab MR comments, Bitbucket PR comments (mirror `postComment.ts` logic)

10. **Team integrations**
    - Slack — diff summary to channel
    - Linear / Jira — auto-create issues for new non-flaky failures
    - GitHub Check Run Annotations — inline hints on changed files

11. **Playwright reporter entry point**
    - Alternative to swapping `test` imports:
      ```ts
      reporter: [["qa-intelligence/reporter", { ai: true }]]
      ```
    - Same artifact + intelligence pipeline underneath

### Tier 4 — Polish & positioning

12. **Consolidate types + validation**
    - Single `Failure` / `DiffResult` source in `types.ts`
    - Validate `failure-diff.json` with Zod (already used in `env.ts`)

13. **Documentation site**
    - Quickstart, CI recipes (monorepo, `playwright/` subfolder, Docker)
    - Architecture: hooks → artifacts → AI → diff → comment
    - Troubleshooting FAQ

14. **Naming & positioning clarity**
    - Align repo (`qa-ci-intelligence`) vs npm (`qa-intelligence`) in docs
    - Tagline options: PR-aware regression gate; "only block on failures you introduced"

---

## Quick wins (this week)

- [ ] 15–20 unit tests for `computeDiff` and `failureIdentity`
- [ ] GitHub Actions workflow: test + build
- [ ] Fixture dirs: `fixtures/baseline-artifacts/`, `fixtures/current-artifacts/` for CLI tests
- [ ] PR comment screenshot in README
- [ ] `CHANGELOG.md` from v1.1.2 onward

---

## Suggested 90-day sequence

| Month | Focus |
|-------|--------|
| 1 | Unit tests, package CI, GitHub Action, README visuals |
| 2 | Programmatic exports, AI provider abstraction, history caching |
| 3 | Flaky watchlist, Check Annotations, first non-GitHub integration |

```
Unit tests + package CI → GitHub Action → README demo + docs site
  → Pluggable AI + programmatic API → Flaky watchlist + Check Annotations
  → GitLab + Slack integrations
```

---

## When implementing

- **Minimize scope** — smallest correct diff; don't refactor unrelated code
- **Reuse existing modules** — extend `computeDiff`, `format`, hooks rather than parallel implementations
- **Tests before big behavior changes** — especially diff classification and blocking logic
- **Preserve backward compatibility** — breaking CLI flags or export paths needs semver + changelog note

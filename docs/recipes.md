# Recipes

Patterns that are useful for some projects but too opinionated to bake into the default
`qa-intelligence init` scaffold. Copy what applies into your own workflow file.

## Skip a suite when only an unrelated app/package changed (monorepo)

If your repo contains more than one app or brand under test (a monorepo, or a single Playwright
suite covering multiple product surfaces), you don't want a change to one to trigger the other's
regression suite. Use [`dorny/paths-filter`](https://github.com/dorny/paths-filter) to detect which
areas changed, then gate each suite's run on the result:

```yaml
- name: Determine which app(s) changed
  id: filter
  uses: dorny/paths-filter@v3
  with:
    token: ${{ github.token }}
    predicate-quantifier: 'every'
    filters: |
      app_a_only:
        - 'apps/app-a/**'
        - 'playwright/tests/app-a/**'
      app_b_only:
        - 'apps/app-b/**'
        - 'playwright/tests/app-b/**'

- name: Run App A regression
  if: steps.filter.outputs.app_b_only != 'true'
  run: npm run test:app-a

- name: Run App B regression
  if: steps.filter.outputs.app_a_only != 'true'
  run: npm run test:app-b
```

`predicate-quantifier: 'every'` means `app_a_only` is only `true` when **every** changed file matches
that filter — so a PR touching both apps runs both suites, and a PR touching only one app skips the
other.

Each app's suite needs its own `BASE_URL`/credentials/artifact names (e.g.
`ai-failure-artifacts-app-a`, `ai-failure-artifacts-app-b`) so the diff/history/baseline steps in the
default workflow don't mix results from different apps — duplicate the diff/history/comment steps per
app, or run `qa-intelligence-diff`/`qa-intelligence-comment` once per app with distinct
`--baseline`/`--current` paths.

## Reuse a merge's source-PR results across more than one test matrix leg

The default scaffolded workflow (`.github/workflows/qa-intelligence.yml`) already reuses a merged PR's
regression results on `push` instead of re-running the suite (see the "Find source PR for this merge" /
"Try to reuse the source PR's results" steps). If you split into multiple parallel legs (per the
path-filtering pattern above), repeat that same three-step block per leg, downloading each leg's own
artifact name (e.g. `ai-failure-artifacts-app-a` for App A's leg) instead of the shared
`ai-failure-artifacts` name.

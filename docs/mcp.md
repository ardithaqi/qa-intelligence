# MCP server

Status: built in 2.0. See the README section "AI assistants (MCP)" for setup.

## Goal

Let coding agents (Claude Code, Cursor and others) ask the guardian directly: "is this PR safe?", "why did checkout break?", "which tests are flaky?". They get the same verdict, causes and fixes as the PR comment, as structured data, without opening GitHub.

Example flow:

```
You:    why is my PR blocked?
Agent:  -> get_pr_verdict()        BLOCK, 1 regression in Checkout, likely cause src/lib/money.ts
        -> explain_problem("G1")   roundCents switched Math.round to Math.floor, fix: restore Math.round
        "Your change to roundCents floors 29.6 to 29. Want me to fix it?"
        (fixes the code, reruns the test)
        -> analyze_local()         SAFE TO MERGE
```

## Decisions

| Question | Decision |
|---|---|
| Server name | `release-guardian` |
| No CI result for the PR yet | `get_pr_verdict` says so and points to `analyze_local`. It does not run the local analysis by itself. |
| Packaging | Same npm package (`qa-intelligence`), started with `ai-release-guardian mcp` |
| Discovery | `init` writes `.mcp.json` and `.cursor/mcp.json`; the editor offers the server to everyone who opens the repo |
| AI calls from the server | None by default. The calling agent is the AI: the server returns evidence (errors, diff of the likely cause, history). Explanations already computed in CI are read from the report. |
| Writes | None for now. Write tools come later behind `--allow-write` and ask for confirmation. |
| Transport | stdio, local to the developer's machine |

## Tools (all read-only)

| Tool | Input | Returns | Data source |
|---|---|---|---|
| `get_pr_verdict` | `pr?` (default: the current branch's PR) | decision, risk, AI summary, one line per problem. Without a CI result: "No CI result for this PR yet. Run analyze_local for a local verdict." | `release-report.json` artifact from the PR's latest CI run |
| `explain_problem` | problem id (`G1`) or test path | tests with file and line, likely cause file and commit, AI explanation, fix, error snippet | same report |
| `analyze_local` | `base?` (default: the repo's default branch, detected from git) | a fresh verdict from the local Playwright run, before pushing | local `artifacts/`, git |
| `flaky_tests` | `limit?` | most unstable tests with fail rate | history cache |
| `failure_history` | test path | failure count, first seen, recent pattern | history cache |

Output follows the PR comment's style: verdict and one line per problem first, details only when asked, to keep the agent's context small.

## Resources

- `guardian://pr/{number}/report`: the full report as JSON
- `guardian://local/report`: the last local analysis

## Later (3.x)

- `create_issue` (ties into the v3 issue creation) and `quarantine_test`, behind `--allow-write`
- A ready-made "fix my failing PR" prompt

## Setup for users

`init` writes the editor configs, so teams commit them once and everyone who opens the repo is asked to enable the server:

```json
// .mcp.json (Claude Code) and .cursor/mcp.json (Cursor), merged into existing files
{ "mcpServers": { "release-guardian": { "command": "node", "args": ["playwright/node_modules/qa-intelligence/dist/cli/guardian.js", "mcp"] } } }
```

By hand: `claude mcp add release-guardian -- node playwright/node_modules/qa-intelligence/dist/cli/guardian.js mcp`.

Not `npx ai-release-guardian`: the npm package is `qa-intelligence`, so npx would search npm for a different package of that name.

`get_pr_verdict` needs a GitHub token (`GITHUB_TOKEN`, or `gh auth token` when the GitHub CLI is signed in) to read the PR's CI artifact.

## Code layout

```
src/mcp/
  server.ts    stdio server, registers tools and resources (@modelcontextprotocol/sdk)
  tools.ts     pure handlers: input -> result, unit tested
  github.ts    find the PR for the branch, download its release-report artifact
src/cli/guardian.ts   new subcommand: ai-release-guardian mcp
```

Reuses 2.0: `analyzeRelease`, the comment formatter (short text form), `loadHistory`, `computeFlakyWatchlist`, `collectChanges`, `collectPatches`. New dependency: the MCP SDK.

## Testing

- Unit tests per tool handler with fixture reports (no network)
- A fake GitHub client for `get_pr_verdict`, including the "no CI result yet" case
- One end-to-end check with the MCP Inspector and one with Claude Code against the scenario repos

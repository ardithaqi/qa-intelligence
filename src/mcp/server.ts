import fs from "fs";
import path from "path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createGitHubClient, githubToken, repoFromGit } from "./github";
import {
    analyzeLocal,
    explainProblem,
    failureHistory,
    flakyTests,
    getPrVerdict,
    GuardianSession,
    type ToolDeps,
} from "./tools";

export const SERVER_NAME = "release-guardian";

function packageVersion(): string {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")).version ?? "0.0.0";
    } catch {
        return "0.0.0";
    }
}

/** GitHub access from the `origin` remote plus GITHUB_TOKEN / `gh auth token`. */
export function defaultDeps(cwd: string = process.cwd()): ToolDeps {
    const repo = repoFromGit(cwd);
    if (!repo) return { cwd, github: null, githubProblem: "no GitHub `origin` remote in this repo" };
    const token = githubToken();
    if (!token) return { cwd, github: null, githubProblem: "no token (set GITHUB_TOKEN or sign in with `gh auth login`)" };
    return { cwd, github: createGitHubClient(repo.owner, repo.repo, token) };
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

export function createServer(deps: ToolDeps = defaultDeps()): McpServer {
    const session = new GuardianSession(deps);
    const server = new McpServer(
        { name: SERVER_NAME, version: packageVersion() },
        {
            instructions:
                "AI Release Guardian: the verdict on a PR's Playwright failures (SAFE TO MERGE, REVIEW REQUIRED, BLOCK), " +
                "what broke, the likely cause and a fix. Start with get_pr_verdict (CI result) or analyze_local " +
                "(the developer's local run), then explain_problem for details. All tools are read-only.",
        }
    );

    server.registerTool(
        "get_pr_verdict",
        {
            title: "PR verdict from CI",
            description:
                "Verdict for a pull request from its latest CI run: decision, risk, AI summary, one line per problem. " +
                "Defaults to the open PR of the current git branch. Says so when CI hasn't produced a result yet.",
            inputSchema: { pr: z.number().int().positive().optional().describe("PR number; default: the current branch's open PR") },
            annotations: readOnly,
        },
        async ({ pr }) => text(await getPrVerdict(session, pr))
    );

    server.registerTool(
        "analyze_local",
        {
            title: "Verdict for the local run",
            description:
                "Analyzes the developer's local Playwright results (artifacts/) against the base branch, including " +
                "uncommitted changes. Use before pushing, or to check a fix. Run the tests first.",
            inputSchema: { base: z.string().optional().describe("Base ref to compare with; default: the remote's default branch") },
            annotations: { ...readOnly, openWorldHint: false },
        },
        async ({ base }) => text(await analyzeLocal(session, base))
    );

    server.registerTool(
        "explain_problem",
        {
            title: "Explain one problem",
            description:
                "Details for one problem from the last verdict: failing tests with file and line, likely cause file and " +
                "commit, AI explanation and fix, why it was classified that way, and the error.",
            inputSchema: { problem: z.string().min(1).describe('Problem id from the verdict (e.g. "G1") or a test file path') },
            annotations: { ...readOnly, openWorldHint: false },
        },
        async ({ problem }) => text(explainProblem(session, problem))
    );

    server.registerTool(
        "flaky_tests",
        {
            title: "Flaky tests",
            description: "The most unstable tests: fail rate across recent CI runs, plus tests that only passed on retry in the latest run.",
            inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Max tests to list (default 10)") },
            annotations: { ...readOnly, openWorldHint: false },
        },
        async ({ limit }) => text(flakyTests(session, limit ?? 10))
    );

    server.registerTool(
        "failure_history",
        {
            title: "Failure history of a test",
            description: "How often a test failed, since when, whether it's intermittent, and how it's classified now.",
            inputSchema: { test: z.string().min(1).describe("Test file path, e.g. tests/checkout.spec.ts") },
            annotations: { ...readOnly, openWorldHint: false },
        },
        async ({ test }) => text(failureHistory(session, test))
    );

    server.registerResource(
        "latest-report",
        "guardian://report/latest",
        { title: "Last loaded report", description: "Full JSON of the last verdict loaded in this session", mimeType: "application/json" },
        async (uri) => ({
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(session.last ?? null, null, 2) }],
        })
    );

    server.registerResource(
        "pr-report",
        new ResourceTemplate("guardian://pr/{number}/report", { list: undefined }),
        { title: "PR report", description: "Full JSON report of a PR's latest CI run", mimeType: "application/json" },
        async (uri, { number }) => {
            const message = await getPrVerdict(session, Number(number));
            const body = session.last?.source.startsWith(`PR #${Number(number)} `) ? session.last : { message };
            return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(body, null, 2) }] };
        }
    );

    return server;
}

/** `ai-release-guardian mcp`: stdio server. stdout belongs to the protocol. */
export async function startStdioServer(): Promise<void> {
    console.log = console.error;
    console.info = console.error;
    const server = createServer();
    await server.connect(new StdioServerTransport());
}

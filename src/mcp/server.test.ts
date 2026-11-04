import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TSX = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");
const CLI = path.resolve(__dirname, "..", "cli", "guardian.ts");

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

describe("MCP server over stdio (as an editor would use it)", () => {
    it("lists the five read-only tools and answers analyze_local / explain_problem", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-mcp-e2e-"));
        const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
        git("init", "-q", "-b", "main");
        git("config", "user.email", "t@example.invalid");
        git("config", "user.name", "T");
        git("config", "commit.gpgsign", "false");
        fs.writeFileSync(path.join(root, "README.md"), "x");
        git("add", ".");
        git("commit", "-qm", "init");
        const attempt = path.join(root, "artifacts", "run-1", "checkout.spec.ts", "t", "attempt-1");
        fs.mkdirSync(attempt, { recursive: true });
        fs.writeFileSync(path.join(attempt, "meta.json"), JSON.stringify({
            file: "tests/checkout.spec.ts", line: 5, retry: 1, errorMessage: 'Expected: "30"\nReceived: "20"',
        }));

        const client = new Client({ name: "test", version: "0.0.0" });
        const transport = new StdioClientTransport({
            command: TSX,
            args: [CLI, "mcp"],
            cwd: root,
            // No GitHub access in tests: no token, so nothing touches the network.
            env: { PATH: process.env.PATH ?? "", HOME: root, GITHUB_TOKEN: "", GH_TOKEN: "" },
            stderr: "ignore",
        });
        try {
            await client.connect(transport);
            assert.equal(client.getServerVersion()?.name, "release-guardian");

            const { tools } = await client.listTools();
            assert.deepEqual(tools.map((t) => t.name).sort(), ["analyze_local", "explain_problem", "failure_history", "flaky_tests", "get_pr_verdict"]);
            assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true), "all tools are read-only");

            const verdict = textOf(await client.callTool({ name: "analyze_local", arguments: { base: "main" } }));
            assert.match(verdict, /^BLOCK/);
            assert.match(verdict, /G1 Regression · tests\/checkout\.spec\.ts:5 · expected "30", got "20"/);

            const detail = textOf(await client.callTool({ name: "explain_problem", arguments: { problem: "G1" } }));
            assert.match(detail, /^G1 Regression \(1 test\)/);

            const pr = textOf(await client.callTool({ name: "get_pr_verdict", arguments: {} }));
            assert.match(pr, /^Can't reach GitHub: no GitHub `origin` remote/);
        } finally {
            await client.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

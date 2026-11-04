import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { CI_SCAFFOLD, detectDefaultBranch, MCP_CONFIG_FILES, PLAYWRIGHT_SCAFFOLD, runInit, writeMcpConfigs } from "../cli/init";

const PLAYWRIGHT_TEMPLATE_FILES = [
    "playwright/.env.example",
    "playwright/gitignore",
    "playwright/tsconfig.json",
    "playwright/playwright.config.ts",
    "playwright/package.json",
    "playwright/tests/example.spec.ts",
];

const CI_TEMPLATE_FILES = ["github/workflows/qa-intelligence.yml"];

describe("runInit", () => {
    let tempRoot = "";

    afterEach(() => {
        if (tempRoot) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
            tempRoot = "";
        }
    });

    it("all scaffold templates exist (npm must ship them)", () => {
        const templatesRoot = path.join(__dirname, "..", "..", "templates");

        for (const file of [...PLAYWRIGHT_TEMPLATE_FILES, ...CI_TEMPLATE_FILES]) {
            assert.ok(
                fs.existsSync(path.join(templatesRoot, file)),
                `missing template: ${file}`
            );
        }
    });

    it("creates playwright scaffold and CI workflow", () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-"));

        const { written, skipped } = runInit({ root: tempRoot });

        assert.equal(skipped.length, 0);
        assert.ok(written.includes("playwright/playwright.config.ts"));
        assert.ok(written.includes("playwright/.gitignore"));
        assert.ok(written.includes(".github/workflows/qa-intelligence.yml"));
        assert.ok(
            fs.existsSync(path.join(tempRoot, "playwright/tests/example.spec.ts"))
        );
    });

    it("skips existing files unless force is set", () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-"));
        runInit({ root: tempRoot });

        const second = runInit({ root: tempRoot });
        assert.equal(second.written.length, 0);
        assert.ok(second.skipped.length > 0);

        const forced = runInit({ root: tempRoot, force: true });
        assert.ok(forced.written.length > 0);
    });

    it("omits CI workflow with withCi false", () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-"));

        const { written } = runInit({ root: tempRoot, withCi: false });

        assert.ok(!written.some((f) => f.includes(".github")));
        assert.ok(fs.existsSync(path.join(tempRoot, "playwright/package.json")));
    });
});

describe("published template files", () => {
    it("package.json ships exactly the files init copies, nothing else from templates/", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
        const shipped = (pkg.files as string[]).filter((f) => f.startsWith("templates")).sort();
        const scaffolded = [...PLAYWRIGHT_SCAFFOLD, ...CI_SCAFFOLD].map((e) => `templates/${e.template}`).sort();

        assert.deepEqual(shipped, scaffolded);
        assert.ok(!shipped.includes("templates"), "never publish the whole templates/ folder");
    });
});

describe("MCP config for AI assistants", () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-mcp-"));

    it("registers release-guardian for Claude Code and Cursor, running the local install", () => {
        const root = tmp();
        try {
            const { written } = runInit({ root, withCi: false });
            assert.ok(written.includes(".mcp.json") && written.includes(".cursor/mcp.json"));
            for (const rel of MCP_CONFIG_FILES) {
                const config = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
                assert.deepEqual(config.mcpServers["release-guardian"], {
                    command: "node",
                    args: ["playwright/node_modules/qa-intelligence/dist/cli/guardian.js", "mcp"],
                });
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps servers already configured and doesn't overwrite without --force", () => {
        const root = tmp();
        try {
            fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
            writeMcpConfigs(root, false);
            const merged = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
            assert.deepEqual(Object.keys(merged.mcpServers).sort(), ["other", "release-guardian"]);

            const second = writeMcpConfigs(root, false);
            assert.deepEqual(second.skipped, [".mcp.json", ".cursor/mcp.json"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("leaves an invalid JSON file alone, and --no-mcp writes nothing", () => {
        const root = tmp();
        try {
            fs.writeFileSync(path.join(root, ".mcp.json"), "{ not json");
            const r = writeMcpConfigs(root, true);
            assert.match(r.skipped[0], /\.mcp\.json \(not valid JSON, left untouched\)/);
            assert.equal(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"), "{ not json");

            const other = tmp();
            runInit({ root: other, withCi: false, withMcp: false });
            assert.ok(!fs.existsSync(path.join(other, ".mcp.json")));
            fs.rmSync(other, { recursive: true, force: true });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("default branch detection", () => {
    const repo = (branch: string) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-branch-"));
        execFileSync("git", ["init", "-q", "-b", branch], { cwd: root, stdio: "ignore" });
        return root;
    };
    const pushBranches = (root: string) =>
        fs.readFileSync(path.join(root, CI_SCAFFOLD[0].dest), "utf8").match(/push:\n\s+branches: (\[[^\]]*\])/)?.[1];

    it("writes the repo's own default branch into the workflow, whatever it's called", () => {
        for (const branch of ["dev", "pre-dev"]) {
            const root = repo(branch);
            try {
                assert.equal(detectDefaultBranch(root), branch);
                runInit({ root, withMcp: false });
                assert.equal(pushBranches(root), `[${branch}]`);
                assert.match(fs.readFileSync(path.join(root, CI_SCAFFOLD[0].dest), "utf8"), /pull_request:\n(?!\s+branches)/, "PRs into any branch");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    it("keeps main/master, and leaves the template alone outside a git repo", () => {
        const root = repo("main");
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-nogit-"));
        try {
            runInit({ root, withMcp: false });
            assert.equal(pushBranches(root), "[main, master]");
            assert.equal(detectDefaultBranch(plain), undefined);
            runInit({ root: plain, withMcp: false });
            assert.equal(pushBranches(plain), "[main, master]");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(plain, { recursive: true, force: true });
        }
    });
});

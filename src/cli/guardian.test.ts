import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { commentOptionsFromEnv, exitCodeFor } from "./guardian";

const CLI = path.resolve(__dirname, "guardian.ts");
const TSX = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");

function workspace(fn: (root: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-cli-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    try {
        git("init", "-q", "-b", "main");
        git("config", "user.email", "t@example.invalid");
        git("config", "user.name", "T");
        git("config", "commit.gpgsign", "false");
        fs.writeFileSync(path.join(root, "README.md"), "x");
        git("add", ".");
        git("commit", "-qm", "base");
        git("checkout", "-qb", "feature");
        fs.mkdirSync(path.join(root, "src", "checkout"), { recursive: true });
        fs.writeFileSync(path.join(root, "src", "checkout", "cart.ts"), "changed");
        git("add", ".");
        git("commit", "-qm", "rework cart totals");
        fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function writeMeta(root: string, spec: string, meta: object) {
    const dir = path.join(root, "artifacts", "run-1", spec, "t", "attempt-1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
}

function run(root: string, ...args: string[]) {
    return runWith(root, {}, ...args);
}

function runWith(root: string, env: NodeJS.ProcessEnv, ...args: string[]) {
    return spawnSync(TSX, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GITHUB_SHA: "", GITHUB_BASE_REF: "", RELEASE_GUARDIAN_BASE: "", RELEASE_GUARDIAN_FAIL_ON: "", RELEASE_GUARDIAN_AI: "off", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", AI_API_KEY: "", ...env },
    });
}

describe("exitCodeFor", () => {
    it("maps decisions to exit codes per policy", () => {
        assert.equal(exitCodeFor("BLOCK", "review"), 1);
        assert.equal(exitCodeFor("REVIEW REQUIRED", "review"), 1);
        assert.equal(exitCodeFor("REVIEW REQUIRED", "block"), 0);
        assert.equal(exitCodeFor("BLOCK", "block"), 1);
        assert.equal(exitCodeFor("BLOCK", "never"), 0);
        assert.equal(exitCodeFor("SAFE TO MERGE", "review"), 0);
    });
});

describe("ai-release-guardian analyze (CLI)", () => {
    it("detects the branch the PR merges into, with no setting", () => {
        workspace((root) => {
            writeMeta(root, "checkout.spec.ts", { file: "tests/checkout.spec.ts", line: 9, retry: 1, errorMessage: "Expected: 30\nReceived: 20" });
            const sha = execFileSync("git", ["rev-parse", "main"], { cwd: root, encoding: "utf8" }).trim();
            const read = () => JSON.parse(fs.readFileSync(path.join(root, "release-report.json"), "utf8")).report.baseBranch;

            // On a GitHub PR run: the PR's target branch, even when --base is a commit SHA.
            runWith(root, { GITHUB_BASE_REF: "pre-dev" }, "analyze", "--base", sha, "--fail-on", "never");
            assert.equal(read(), "pre-dev");
            // Locally: the branch named in --base.
            run(root, "analyze", "--base", "origin/dev", "--fail-on", "never");
            assert.equal(read(), "dev");
            // A bare SHA names no branch.
            run(root, "analyze", "--base", sha, "--fail-on", "never");
            assert.equal(read(), undefined);
        });
    });

    it("blocks a new checkout regression, attributes it, and writes both reports", () => {
        workspace((root) => {
            writeMeta(root, "checkout.spec.ts", {
                title: "cart total updates",
                file: "tests/checkout.spec.ts",
                line: 9,
                retry: 1,
                errorMessage: "expect(received).toBe(expected)\nExpected: 30\nReceived: 20",
            });
            fs.writeFileSync(
                path.join(root, "artifacts", "run-summary.json"),
                JSON.stringify({ total: 12, passed: 11, failed: 1, flaky: 0, skipped: 0 })
            );

            const result = run(root, "analyze", "--base", "main");
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stdout, /\*\*BLOCK\*\*/);

            const saved = JSON.parse(fs.readFileSync(path.join(root, "release-report.json"), "utf8"));
            assert.equal(saved.report.decision, "BLOCK");
            assert.equal(saved.report.testsAnalyzed, 12);
            assert.equal(saved.report.primaryGroup.rootCause, "src/checkout/cart.ts");
            assert.ok(saved.diff.newFailures.length === 1);

            const md = fs.readFileSync(path.join(root, "release-guardian.md"), "utf8");
            assert.match(md, /likely cause <code>src\/checkout\/cart\.ts<\/code>/);
            assert.match(md, /commit `[0-9a-f]{7}` "rework cart totals"/);

            assert.equal(run(root, "analyze", "--base", "main", "--fail-on", "never").status, 0);
        });
    });

    it("passes when only a flaky failure is present, even with --fail-on review", () => {
        workspace((root) => {
            writeMeta(root, "search.spec.ts", {
                file: "tests/search.spec.ts",
                line: 2,
                retry: 1,
                is_flaky_suspected: true,
                errorMessage: "Test timeout of 30000ms exceeded.",
            });
            const result = run(root, "--base", "main", "--fail-on", "review");
            assert.equal(result.status, 0, result.stdout + result.stderr);
            assert.match(result.stdout, /SAFE TO MERGE/);
        });
    });

    it("exits 2 on invalid usage", () => {
        workspace((root) => {
            const bad = run(root, "analyze", "--fail-on", "sometimes");
            assert.equal(bad.status, 2);
            assert.match(bad.stderr, /--fail-on must be one of/);
            assert.equal(run(root, "frobnicate").status, 2);
        });
    });
});

describe("commentOptionsFromEnv", () => {
    it("builds GitHub links from Actions env and prefers the PR head sha", () => {
        const o = commentOptionsFromEnv(
            { GITHUB_REPOSITORY: "acme/shop", GITHUB_SHA: "merge123", RELEASE_GUARDIAN_HEAD_SHA: "head456", GITHUB_RUN_ID: "99" },
            os.tmpdir()
        );
        assert.equal(o.links?.sha, "head456");
        assert.equal(o.links?.server, "https://github.com");
        assert.equal(o.runUrl, "https://github.com/acme/shop/actions/runs/99");
    });

    it("adds no links outside CI", () => {
        assert.deepEqual(commentOptionsFromEnv({}), {});
    });
});

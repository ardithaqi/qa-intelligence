import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { analyzeRelease } from "../guardian/analyzeRelease";
import type { DiffResult, Failure } from "../lib/types";
import type { GitHubClient } from "./github";
import {
    analyzeLocal,
    BASELINE_ARTIFACT,
    explainProblem,
    failureHistory,
    flakyTests,
    getPrVerdict,
    GuardianSession,
    REPORT_ARTIFACT_PREFIX,
} from "./tools";

const f = (file: string, over: Partial<Failure> = {}): Failure => ({
    file,
    line: 5,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 60,
    retry: 1,
    title: "cart total includes shipping",
    errorMessage: 'Error: expect(locator).toHaveText(expected) failed\nExpected: "30"\nReceived: "20"\nCall log:\n  - waiting',
    source: "heuristic",
    ...over,
});

const diffOf = (o: Partial<DiffResult>): DiffResult => ({ newFailures: [], unchangedFailures: [], fixedFailures: [], ...o });

/** A release-report.json as the CI workflow uploads it, zipped like a GitHub artifact. */
function reportZip(diff: DiffResult, changes = { files: [{ path: "src/checkout/cartTotal.ts", commit: "abc1234def" }] }): Uint8Array {
    const report = analyzeRelease(diff, { changes });
    return zipSync({ "release-report.json": strToU8(JSON.stringify({ report, diff })) });
}

function fakeGitHub(over: Partial<GitHubClient> = {}): GitHubClient & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        findOpenPr: async (branch) => (calls.push(`findOpenPr ${branch}`), { number: 7, headSha: "1111111aaaa" }),
        prHeadSha: async (pr) => (calls.push(`prHeadSha ${pr}`), pr === 404 ? null : "2222222bbbb"),
        artifactForCommit: async (sha, prefix) => (calls.push(`artifactForCommit ${sha} ${prefix}`), null),
        artifactForBranch: async () => null,
        ...over,
    };
}

function repo(fn: (root: string, git: (...a: string[]) => string) => void | Promise<void>) {
    return async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-mcp-"));
        const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        try {
            git("init", "-q", "-b", "feature");
            git("config", "user.email", "t@example.invalid");
            git("config", "user.name", "T");
            git("config", "commit.gpgsign", "false");
            fs.writeFileSync(path.join(root, "README.md"), "x");
            git("add", ".");
            git("commit", "-qm", "init");
            await fn(root, git);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    };
}

function writeMeta(dir: string, spec: string, meta: object) {
    const d = path.join(dir, "run-1", spec, "t", "attempt-1");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify(meta));
}

describe("get_pr_verdict", () => {
    it("explains how to connect when there's no GitHub access", async () => {
        const s = new GuardianSession({ cwd: os.tmpdir(), github: null, githubProblem: "no token (set GITHUB_TOKEN)" });
        assert.match(await getPrVerdict(s), /Can't reach GitHub: no token \(set GITHUB_TOKEN\)\. For a local verdict, use analyze_local\./);
    });

    it("says there's no CI result yet and points to analyze_local", repo(async (root) => {
        const s = new GuardianSession({ cwd: root, github: fakeGitHub() });
        assert.equal(await getPrVerdict(s), "No CI result for this PR yet. Run analyze_local for a local verdict.");
    }));

    it("reads the CI report for the branch's PR and lists problems with ids", repo(async (root) => {
        const github = fakeGitHub({
            artifactForCommit: async (sha, prefix) => (assert.equal(prefix, REPORT_ARTIFACT_PREFIX), reportZip(diffOf({ newFailures: [f("tests/checkout.spec.ts")] }))),
        });
        const s = new GuardianSession({ cwd: root, github });
        const out = await getPrVerdict(s);
        assert.match(out, /^BLOCK · HIGH risk \(\d+\/100\)  \[PR #7 @ 1111111\]/);
        assert.match(out, /G1 Regression · tests\/checkout\.spec\.ts:5 · expected "30", got "20" · likely cause src\/checkout\/cartTotal\.ts/);
        assert.match(out, /Call explain_problem with an id/);
        assert.match(out, /your local HEAD is [0-9a-f]{7}/, "warns that CI ran on a different commit");
        assert.deepEqual(github.calls[0], "findOpenPr feature");
    }));

    it("handles an explicit PR number, unknown PRs and a branch without a PR", repo(async (root) => {
        assert.equal(await getPrVerdict(new GuardianSession({ cwd: root, github: fakeGitHub() }), 404), "PR #404 not found.");
        const noPr = fakeGitHub({ findOpenPr: async () => null });
        assert.match(await getPrVerdict(new GuardianSession({ cwd: root, github: noPr })), /No open PR for branch "feature"/);
    }));
});

describe("analyze_local", () => {
    it("asks to run the tests first when there are no results", repo(async (root) => {
        const out = await analyzeLocal(new GuardianSession({ cwd: root, github: null }));
        assert.match(out, /No local test results in artifacts\/\. Run your Playwright tests first/);
    }));

    it("judges the local run, including uncommitted changes, from the repo root of an init layout", repo(async (root, git) => {
        const pw = path.join(root, "playwright");
        fs.mkdirSync(path.join(root, "src", "checkout"), { recursive: true });
        fs.writeFileSync(path.join(root, "src", "checkout", "cartTotal.ts"), "export const total = 30;\n");
        git("add", ".");
        git("commit", "-qm", "base");
        git("branch", "main");
        // Uncommitted edit: the developer hasn't committed yet.
        fs.writeFileSync(path.join(root, "src", "checkout", "cartTotal.ts"), "export const total = 20;\n");
        writeMeta(path.join(pw, "artifacts"), "checkout.spec.ts", {
            file: "tests/checkout.spec.ts", line: 5, retry: 1, title: "cart total includes shipping",
            errorMessage: 'expect(locator).toHaveText(expected)\nExpected: "30"\nReceived: "20"',
        });
        fs.mkdirSync(path.join(pw, "baseline-artifacts"), { recursive: true });

        const s = new GuardianSession({ cwd: root, github: null });
        const out = await analyzeLocal(s, "main");
        assert.match(out, /^BLOCK/);
        assert.match(out, /\[local run\]/);
        assert.match(out, /likely cause src\/checkout\/cartTotal\.ts/, "uncommitted change is attributed");
        assert.doesNotMatch(out, /No baseline/, "local baseline-artifacts used");
        assert.equal(s.last?.source, "local run");
    }));

    it("downloads the CI baseline when there's none locally", repo(async (root) => {
        writeMeta(path.join(root, "artifacts"), "legacy.spec.ts", { file: "tests/legacy.spec.ts", line: 2, retry: 1, errorMessage: 'Expected: "a"\nReceived: "b"' });
        // Main's baseline already has the same failure, so it is pre-existing.
        const baseline = zipSync({ "run-1/legacy.spec.ts/t/attempt-1/meta.json": strToU8(JSON.stringify({ file: "tests/legacy.spec.ts", line: 2, retry: 1, errorMessage: 'Expected: "a"\nReceived: "b"' })) });
        let asked = "";
        const github = fakeGitHub({ artifactForBranch: async (branch, name) => ((asked = `${branch} ${name}`), baseline) });
        const out = await analyzeLocal(new GuardianSession({ cwd: root, github }), "origin/main");
        assert.equal(asked, `main ${BASELINE_ARTIFACT}`);
        assert.match(out, /^SAFE TO MERGE/);
        assert.match(out, /1 still failing from main/);
    }));
});

describe("explain_problem, flaky_tests, failure_history", () => {
    const loaded = () => {
        const diff = diffOf({
            newFailures: [f("tests/checkout.spec.ts", { occurrence_count: 3, first_seen: "2026-10-01T00:00:00Z" }), f("tests/search.spec.ts", { is_flaky_suspected: true })],
            flakyWatchlist: [{ testFile: "tests/search.spec.ts", failCount: 4, totalRuns: 10, failRate: 0.4 }],
        });
        const s = new GuardianSession({ cwd: os.tmpdir(), github: null });
        s.last = { source: "PR #7 @ 1111111", report: analyzeRelease(diff, { changes: { files: [{ path: "src/checkout/cartTotal.ts", commit: "abc1234def", commitSubject: "round totals" }] } }), diff };
        return s;
    };

    it("asks for a verdict first when nothing is loaded", () => {
        const s = new GuardianSession({ cwd: fs.mkdtempSync(path.join(os.tmpdir(), "empty-")), github: null });
        assert.match(explainProblem(s, "G1"), /^No report loaded yet\. Call get_pr_verdict .* or analyze_local/);
    });

    it("explains a problem by id or by test path, with cause, commit and error up to the call log", () => {
        const s = loaded();
        const out = explainProblem(s, "g1");
        assert.match(out, /^G1 Regression \(1 test\)/);
        assert.match(out, /- tests\/checkout\.spec\.ts:5 "cart total includes shipping"/);
        assert.match(out, /Likely cause: src\/checkout\/cartTotal\.ts \(\d+%, commit abc1234 "round totals"\)/);
        assert.match(out, /Error:\nError: expect\(locator\)\.toHaveText\(expected\) failed\nExpected: "30"\nReceived: "20"$/);
        assert.equal(explainProblem(s, "playwright/tests/checkout.spec.ts:5"), out);
        assert.match(explainProblem(s, "G9"), /No problem "G9" in the PR #7 @ 1111111 report\. Problems: G1, G2\./);
    });

    it("lists flaky tests from CI history and the latest run", () => {
        const out = flakyTests(loaded());
        assert.match(out, /tests\/search\.spec\.ts: failed in 4 of the last 10 runs \(40%\)/);
        assert.match(out, /Flaky in the latest run[\s\S]*tests\/search\.spec\.ts:5/);
    });

    it("gives a test's history and current classification", () => {
        assert.match(failureHistory(loaded(), "tests/checkout.spec.ts"), /Regression, new in this change, failed 3 time\(s\) since 2026-10-01/);
        assert.match(failureHistory(loaded(), "search.spec.ts"), /Intermittent: failed in 4 of the last 10 CI runs\./);
        assert.match(failureHistory(loaded(), "tests/other.spec.ts"), /isn't failing in the PR #7 @ 1111111 report/);
    });
});

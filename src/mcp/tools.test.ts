import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { analyzeRelease } from "../guardian/analyzeRelease";
import type { DiffResult, Failure } from "../lib/types";
import { defaultBaseRef, githubTokens, parseGitHubRemote, pickBaselineArtifacts, type GitHubClient } from "./github";
import {
    analyzeLocal,
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
        baselineForBranch: async () => null,
        ciStateForCommit: async () => "none" as const,
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

    it("explains a token that can't see the repo instead of GitHub's bare Not Found", repo(async (root) => {
        const notFound = Object.assign(new Error("Not Found"), { status: 404 });
        const github = fakeGitHub({ findOpenPr: async () => { throw notFound; } });
        assert.match(await getPrVerdict(new GuardianSession({ cwd: root, github })), /^Can't read the CI result: the GitHub token can't see this repo .*gh auth switch/);
    }));

    it("tells a running, skipped and finished CI run apart", repo(async (root) => {
        const say = (state: "running" | "skipped" | "done") =>
            getPrVerdict(new GuardianSession({ cwd: root, github: fakeGitHub({ ciStateForCommit: async () => state }) }));
        assert.match(await say("running"), /^CI is still running for PR #7 \(commit 1111111\)/);
        assert.match(await say("skipped"), /^CI skipped the test workflow for PR #7 .*don't run it for this PR/);
        assert.match(await say("done"), /^CI ran for PR #7 .* no guardian report: the base branch may have no test results yet/);
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

    it("reads only the newest local run, so a failure fixed since then is gone", repo(async (root) => {
        const meta = { file: "tests/checkout.spec.ts", line: 5, retry: 1, errorMessage: 'Expected: "30"\nReceived: "29"' };
        const old = path.join(root, "artifacts", "run-2026-11-04T08-00-00-000Z", "checkout.spec.ts", "t", "attempt-1");
        fs.mkdirSync(old, { recursive: true });
        fs.writeFileSync(path.join(old, "meta.json"), JSON.stringify(meta));
        fs.mkdirSync(path.join(root, "artifacts", "run-2026-11-04T09-00-00-000Z"), { recursive: true });
        fs.mkdirSync(path.join(root, "baseline-artifacts"), { recursive: true });

        const out = await analyzeLocal(new GuardianSession({ cwd: root, github: null }), "HEAD");
        assert.match(out, /^SAFE TO MERGE/);
        assert.doesNotMatch(out, /checkout/);
    }));

    const summary = (dir: string, s: object) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "run-summary.json"), JSON.stringify({ passed: 0, failed: 0, flaky: 0, skipped: 0, status: "passed", ...s }));
    };

    it("says when only part of the suite ran, and doesn't call skipped tests fixed", repo(async (root) => {
        writeMeta(path.join(root, "baseline-artifacts"), "legacy.spec.ts", { file: "tests/legacy.spec.ts", line: 2, retry: 0, errorMessage: 'Expected: "a"\nReceived: "b"' });
        summary(path.join(root, "baseline-artifacts"), { total: 3 });
        fs.mkdirSync(path.join(root, "artifacts", "run-2026-11-04T09-00-00-000Z"), { recursive: true });
        summary(path.join(root, "artifacts"), { total: 1, passed: 1 });

        const out = await analyzeLocal(new GuardianSession({ cwd: root, github: null }), "HEAD");
        assert.match(out, /^Partial run: only 1 of 3 tests ran/);
        assert.doesNotMatch(out, /fixed/);
    }));

    it("refuses to judge a run that was stopped before it finished", repo(async (root) => {
        writeMeta(path.join(root, "artifacts"), "slow.spec.ts", { file: "tests/slow.spec.ts", line: 2, retry: 0 });
        fs.renameSync(path.join(root, "artifacts", "run-1"), path.join(root, "artifacts", "run-2026-11-04T09-00-00-000Z"));
        summary(path.join(root, "artifacts"), { total: 1, skipped: 1, status: "interrupted" });
        const out = await analyzeLocal(new GuardianSession({ cwd: root, github: null }), "HEAD");
        assert.match(out, /^The latest test run didn't finish/);
    }));

    it("finds results at the repo root when Playwright ran from there (VS Code extension, init layout)", repo(async (root) => {
        fs.mkdirSync(path.join(root, "playwright"));
        const meta = { file: "tests/checkout.spec.ts", line: 5, retry: 0, errorMessage: 'Expected: "30"\nReceived: "29"' };
        const run = path.join(root, "artifacts", "run-2026-11-04T09-00-00-000Z", "checkout.spec.ts", "t", "attempt-0");
        fs.mkdirSync(run, { recursive: true });
        fs.writeFileSync(path.join(run, "meta.json"), JSON.stringify(meta));
        summary(path.join(root, "artifacts"), { total: 1, failed: 1, status: "failed" });

        const out = await analyzeLocal(new GuardianSession({ cwd: root, github: null }), "HEAD");
        assert.match(out, /^BLOCK/);
    }));

    it("downloads the CI baseline when there's none locally", repo(async (root) => {
        writeMeta(path.join(root, "artifacts"), "legacy.spec.ts", { file: "tests/legacy.spec.ts", line: 2, retry: 1, errorMessage: 'Expected: "a"\nReceived: "b"' });
        // The base branch's results already have the same failure, so it is pre-existing.
        const baseline = zipSync({ "run-1/legacy.spec.ts/t/attempt-1/meta.json": strToU8(JSON.stringify({ file: "tests/legacy.spec.ts", line: 2, retry: 1, errorMessage: 'Expected: "a"\nReceived: "b"' })) });
        let asked = "";
        const github = fakeGitHub({ baselineForBranch: async (branch) => ((asked = branch), { runId: 1, zips: [baseline] }) });
        const out = await analyzeLocal(new GuardianSession({ cwd: root, github }), "origin/main");
        assert.equal(asked, "main");
        assert.match(out, /^SAFE TO MERGE/);
        assert.match(out, /1 still failing from main/);
    }));

    it("says which run the baseline came from, and when it ran fewer tests than yours", repo(async (root) => {
        writeMeta(path.join(root, "artifacts"), "a.spec.ts", { file: "tests/a.spec.ts", line: 2, retry: 1, title: "a", errorMessage: 'Expected: "a"\nReceived: "b"' });
        fs.writeFileSync(path.join(root, "artifacts", "run-summary.json"), JSON.stringify({ total: 140, passed: 139, failed: 1, flaky: 0, skipped: 0, status: "failed" }));
        // A smoke-only run on the base branch: 12 tests.
        const smoke = zipSync({ "run-summary.json": strToU8(JSON.stringify({ total: 12, passed: 12, failed: 0, flaky: 0, skipped: 0, status: "passed" })) });
        const github = fakeGitHub({ baselineForBranch: async () => ({ runId: 41, createdAt: "2026-11-04T12:00:00Z", zips: [smoke] }) });
        const out = await analyzeLocal(new GuardianSession({ cwd: root, github }), "origin/dev");
        assert.match(out, /Note: The baseline \(CI run 41 on dev \(2026-11-04\)\) ran 12 tests and yours ran 140: failures in tests it didn't run show up as new\./);

        const full = zipSync({ "run-summary.json": strToU8(JSON.stringify({ total: 140, passed: 140, failed: 0, flaky: 0, skipped: 0, status: "passed" })) });
        const same = fakeGitHub({ baselineForBranch: async () => ({ runId: 42, zips: [full] }) });
        assert.match(await analyzeLocal(new GuardianSession({ cwd: root, github: same }), "origin/dev"), /Note: Baseline: CI run 42 on dev\./);
    }));

    it("works with any base branch name and one upload per brand", repo(async (root) => {
        writeMeta(path.join(root, "artifacts"), "a.spec.ts", { file: "tests/a.spec.ts", line: 2, retry: 1, title: "a", errorMessage: 'Expected: "a"\nReceived: "b"' });
        writeMeta(path.join(root, "artifacts"), "b.spec.ts", { file: "tests/b.spec.ts", line: 2, retry: 1, title: "b", errorMessage: 'Expected: "a"\nReceived: "b"' });
        const one = (spec: string, title: string) =>
            zipSync({ [`run-1/${spec}/t/attempt-1/meta.json`]: strToU8(JSON.stringify({ file: `tests/${spec}`, line: 2, retry: 1, title, errorMessage: 'Expected: "a"\nReceived: "b"' })) });
        let asked = "";
        // Two brands, two uploads from the same run: both count.
        const github = fakeGitHub({ baselineForBranch: async (branch) => ((asked = branch), { runId: 9, zips: [one("a.spec.ts", "a"), one("b.spec.ts", "b")] }) });
        const out = await analyzeLocal(new GuardianSession({ cwd: root, github }), "origin/pre-dev");
        assert.equal(asked, "pre-dev");
        assert.match(out, /2 still failing from pre-dev/);
        assert.doesNotMatch(out, /\bmain\b/);
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

describe("pickBaselineArtifacts", () => {
    it("finds the test results of a run, whatever the uploads are called", () => {
        assert.deepEqual(pickBaselineArtifacts(["playwright-report-1", "playwright-artifacts-1", "playwright-artifacts-baseline"]), ["playwright-artifacts-baseline"]);
        // One full results upload per brand, next to trimmed copies and HTML reports.
        assert.deepEqual(
            pickBaselineArtifacts(["playwright-artifacts-raw-a-7", "playwright-artifacts-a-7", "playwright-report-a-7", "playwright-artifacts-raw-b-7"]),
            ["playwright-artifacts-raw-a-7", "playwright-artifacts-raw-b-7"]
        );
        assert.deepEqual(pickBaselineArtifacts(["playwright-artifacts-41", "playwright-report-41"]), ["playwright-artifacts-41"]);
        assert.deepEqual(pickBaselineArtifacts(["coverage", "playwright-report-41"]), []);
    });
});

describe("defaultBaseRef", () => {
    it("uses origin's default branch, else the first of main, master, dev that exists", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-base-"));
        const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
        try {
            git("init", "-q", "-b", "dev");
            git("config", "user.email", "t@example.invalid");
            git("config", "user.name", "T");
            git("config", "commit.gpgsign", "false");
            fs.writeFileSync(path.join(root, "x"), "x");
            git("add", ".");
            git("commit", "-qm", "x");
            // A repo whose only remote branch is dev, with no origin/HEAD.
            git("update-ref", "refs/remotes/origin/dev", "HEAD");
            assert.equal(defaultBaseRef(root), "origin/dev");
            git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/dev");
            assert.equal(defaultBaseRef(root), "origin/dev");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("parseGitHubRemote", () => {
    const noAlias = () => null;
    it("reads every common GitHub remote format", () => {
        for (const url of [
            "https://github.com/acme/shop.git",
            "https://github.com/acme/shop",
            "https://github.com/acme/shop/",
            "https://user@github.com/acme/shop.git",
            "git@github.com:acme/shop.git",
            "git@github.com:acme/shop",
            "ssh://git@github.com/acme/shop.git",
            "ssh://git@github.com:22/acme/shop.git",
        ]) {
            assert.deepEqual(parseGitHubRemote(url, noAlias), { owner: "acme", repo: "shop" }, url);
        }
    });

    it("accepts an SSH host alias that resolves to github.com (several accounts)", () => {
        const aliases = (h: string) => (h === "github-work" ? "github.com" : null);
        assert.deepEqual(parseGitHubRemote("git@github-work:acme-org/app.git", aliases), { owner: "acme-org", repo: "app" });
        assert.equal(parseGitHubRemote("git@gitlab-work:acme-org/app.git", aliases), null, "an alias for another host");
        assert.equal(parseGitHubRemote("https://gitlab.com/acme/shop.git", aliases), null);
        assert.equal(parseGitHubRemote("https://github-work/acme/shop.git", aliases), null, "aliases only exist for SSH");
    });
});

describe("githubTokens", () => {
    it("tries the env tokens first, without duplicates (signed-in gh accounts come after)", () => {
        const tokens = githubTokens({ GITHUB_TOKEN: "env-a", GH_TOKEN: "env-a" });
        assert.equal(tokens[0], "env-a");
        assert.equal(tokens.filter((t) => t === "env-a").length, 1);
        assert.deepEqual(githubTokens({ GITHUB_TOKEN: "env-a", GH_TOKEN: "env-b" }).slice(0, 2), ["env-a", "env-b"]);
        assert.equal(new Set(tokens).size, tokens.length);
    });
});

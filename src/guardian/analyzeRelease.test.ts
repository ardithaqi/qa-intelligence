import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiffResult, Failure } from "../lib/types";
import { analyzeRelease } from "./analyzeRelease";
import { decideRelease } from "./decision";
import { formatReleaseComment, GUARDIAN_COMMENT_HEADER } from "./format";
import { groupFailures } from "./group";
import { riskLevel, scoreRisk } from "./risk";
import type { ClassifiedFailure, FailureCategory } from "./types";

const f = (file: string, over: Partial<Failure> = {}): Failure => ({
    file,
    line: 5,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 60,
    retry: 1,
    errorMessage: "expect(received).toBe(expected)\nExpected: 200\nReceived: 401",
    source: "heuristic",
    ...over,
});

const diff = (over: Partial<DiffResult> = {}): DiffResult => ({
    newFailures: [],
    unchangedFailures: [],
    fixedFailures: [],
    ...over,
});

const classified = (category: FailureCategory, over: Partial<ClassifiedFailure> = {}): ClassifiedFailure => ({
    failure: f(`tests/${category}-${Math.random().toString(36).slice(2, 6)}.spec.ts`),
    lifecycle: "new",
    classification: { category, confidence: 75, reasons: ["r"] },
    area: "Other",
    critical: false,
    ...over,
});

const flakyNoise = f("tests/search.spec.ts", { is_flaky_suspected: true, errorMessage: "Timed out 5000ms" });
const infraNoise = f("tests/report.spec.ts", { errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED" });

describe("riskLevel", () => {
    it("uses the documented thresholds", () => {
        assert.deepEqual([0, 29, 30, 59, 60, 79, 80, 100].map(riskLevel), [
            "LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL", "CRITICAL",
        ]);
    });
});

describe("scoreRisk", () => {
    it("is 0 / LOW with nothing new, and ignores pre-existing failures", () => {
        const r = scoreRisk([classified("regression", { lifecycle: "existing" })], []);
        assert.equal(r.score, 0);
        assert.equal(r.level, "LOW");
    });

    it("one regression is MEDIUM; in a critical area it is HIGH", () => {
        assert.equal(scoreRisk([classified("regression")], []).level, "MEDIUM");
        const critical = scoreRisk([classified("regression", { critical: true, area: "Payment" })], []);
        assert.equal(critical.score, 60);
        assert.equal(critical.level, "HIGH");
        assert.ok(critical.reasons.some((r) => r.includes("Payment")));
    });

    it("noise alone stays LOW", () => {
        const r = scoreRisk([classified("flaky"), classified("flaky"), classified("infrastructure")], []);
        assert.equal(r.score, 9);
        assert.equal(r.level, "LOW");
    });

    it("explains every point and caps at 100", () => {
        const many = Array.from({ length: 10 }, (_, i) =>
            classified("regression", { critical: true, area: `A${i}` })
        );
        const r = scoreRisk([...many, ...Array.from({ length: 5 }, () => classified("unknown"))], []);
        assert.equal(r.score, 100);
        assert.ok(r.reasons.every((x) => /^\+\d+ /.test(x)));
    });
});

describe("decideRelease", () => {
    const decide = (failures: ClassifiedFailure[], testsAnalyzed?: number) => {
        const groups = groupFailures(failures.filter((x) => x.lifecycle === "new"));
        return decideRelease({ failures, groups, risk: scoreRisk(failures, groups), testsAnalyzed });
    };

    it("SAFE with no failures", () => {
        assert.equal(decide([]).decision, "SAFE TO MERGE");
    });

    it("SAFE with only flaky / infrastructure / pre-existing failures", () => {
        const r = decide([
            classified("flaky"),
            classified("infrastructure"),
            classified("regression", { lifecycle: "existing" }),
        ], 200);
        assert.equal(r.decision, "SAFE TO MERGE");
        assert.match(r.reason, /flaky/);
    });

    it("REVIEW when infrastructure failures swamp the run", () => {
        const r = decide(Array.from({ length: 5 }, () => classified("infrastructure")), 300);
        assert.equal(r.decision, "REVIEW REQUIRED");
        assert.match(r.reason, /rerun/);
    });

    it("REVIEW for unknown, test issues, or low-confidence regressions", () => {
        assert.equal(decide([classified("unknown")]).decision, "REVIEW REQUIRED");
        assert.equal(decide([classified("test_issue")]).decision, "REVIEW REQUIRED");
        assert.equal(
            decide([classified("regression", { classification: { category: "regression", confidence: 55, reasons: [] } })]).decision,
            "REVIEW REQUIRED"
        );
    });

    it("BLOCK for a confident new regression", () => {
        const r = decide([classified("regression", { area: "Checkout" })]);
        assert.equal(r.decision, "BLOCK");
        assert.match(r.reason, /Checkout/);
    });

    it("BLOCK for a low-confidence regression when overall risk is HIGH", () => {
        const low = { category: "regression" as const, confidence: 55, reasons: [] };
        const r = decide([classified("regression", { classification: low, critical: true, area: "Payment" })]);
        assert.equal(r.decision, "BLOCK");
    });
});

describe("groupFailures", () => {
    it("groups failures implicating the same changed file across suites", () => {
        const attribution = { path: "src/auth/session.ts", kind: "naming" as const, confidence: 45, evidence: "e", commit: "82fa7d01" };
        const groups = groupFailures([
            classified("regression", { attribution, area: "Authentication" }),
            classified("regression", { attribution, area: "Profile" }),
            classified("unknown", { attribution, area: "Checkout" }),
            classified("flaky"),
        ]);
        assert.equal(groups[0].rootCause, "src/auth/session.ts");
        assert.equal(groups[0].failures.length, 3);
        assert.equal(groups[0].commit, "82fa7d01");
        assert.equal(groups[0].confidence, 60, "45 + corroboration from 3 suites");
        assert.deepEqual(groups[0].areas, ["Authentication", "Profile", "Checkout"]);
    });

    it("groups identical error signatures that differ only in values", () => {
        const groups = groupFailures([
            classified("regression", { failure: f("tests/a.spec.ts", { errorMessage: "Expected 3 items, got 4" }) }),
            classified("regression", { failure: f("tests/b.spec.ts", { errorMessage: "Expected 7 items, got 1" }) }),
        ]);
        assert.equal(groups.length, 1);
        assert.equal(groups[0].rootCauseKind, "error_signature");
    });

    it("orders regressions before noise", () => {
        const groups = groupFailures([classified("flaky"), classified("regression")]);
        assert.equal(groups[0].category, "regression");
        assert.equal(groups[0].id, "G1");
    });
});

describe("analyzeRelease", () => {
    it("session regression across three critical flows → BLOCK with attribution", () => {
        const sessionError = "expect(page).toHaveURL(expected)\nExpected: /dashboard\nReceived: /login";
        const report = analyzeRelease(
            diff({
                newFailures: [
                    f("tests/login.spec.ts", { title: "stays signed in after reload", errorMessage: sessionError }),
                    f("tests/profile.spec.ts", { title: "session persists on profile", errorMessage: sessionError, url: "https://app.test/profile" }),
                    f("tests/checkout.spec.ts", { title: "checkout keeps session", errorMessage: sessionError }),
                    flakyNoise,
                    infraNoise,
                ],
                unchangedFailures: [f("tests/legacy.spec.ts")],
                fixedFailures: [f("tests/old.spec.ts")],
            }),
            {
                changes: {
                    files: [
                        { path: "src/auth/session.ts", commit: "82fa7d0c0ffee", commitSubject: "Persist session token in storage" },
                        { path: "src/ui/theme.css" },
                    ],
                },
                runSummary: { total: 248, passed: 240, failed: 6, flaky: 1, skipped: 1 },
            }
        );

        assert.equal(report.decision, "BLOCK");
        assert.equal(report.testsAnalyzed, 248);
        assert.equal(report.failureCount, 6);
        assert.deepEqual(report.counts, { regression: 3, flaky: 1, infrastructure: 1, test_issue: 0, unknown: 0 });
        assert.equal(report.preExistingCount, 1);
        assert.equal(report.fixedCount, 1);
        assert.equal(report.primaryGroup?.rootCause, "src/auth/session.ts");
        assert.equal(report.primaryGroup?.failures.length, 3);
        assert.equal(report.primaryGroup?.commit, "82fa7d0c0ffee");
        assert.ok(report.affectedAreas.includes("Authentication"));
        assert.ok(report.affectedAreas.includes("Checkout"));
        assert.ok(["HIGH", "CRITICAL"].includes(report.risk.level));
        assert.match(report.decisionReason, /session\.ts/);

        const md = formatReleaseComment(report, undefined, { commit: "abcdef1234" });
        assert.ok(md.startsWith(GUARDIAN_COMMENT_HEADER));
        assert.match(md, /⛔ BLOCK/);
        assert.match(md, /Tests analyzed: 248/);
        assert.match(md, /Real regressions: 3/);
        assert.match(md, /Probable root cause:\*\* `src\/auth\/session\.ts`/);
        assert.match(md, /Likely introduced by:\*\* commit `82fa7d0` — Persist session token/);
    });

    it("flaky + infra only → SAFE TO MERGE, LOW risk", () => {
        const report = analyzeRelease(diff({ newFailures: [flakyNoise, infraNoise] }), {
            runSummary: { total: 100, passed: 98, failed: 1, flaky: 1, skipped: 0 },
        });
        assert.equal(report.decision, "SAFE TO MERGE");
        assert.equal(report.risk.level, "LOW");
        assert.equal(report.primaryGroup, undefined);
    });

    it("pre-existing failures alone don't block or add risk", () => {
        const report = analyzeRelease(diff({ unchangedFailures: [f("tests/login.spec.ts")] }));
        assert.equal(report.decision, "SAFE TO MERGE");
        assert.equal(report.risk.score, 0);
        assert.equal(report.preExistingCount, 1);
    });

    it("uses history: an intermittent test failing with a timeout is flaky, not unknown", () => {
        const timeout = f("tests/search.spec.ts", { failure_type: "timeout", errorMessage: "Test timeout of 30000ms exceeded." });
        const runs = Array.from({ length: 10 }, (_, i) => ({
            sha: `s${i}`,
            timestamp: `2026-10-${10 + i}T00:00:00Z`,
            failureKeys: i % 3 === 0 ? ["tests/search.spec.ts:timeout"] : [],
        }));
        const report = analyzeRelease(diff({ newFailures: [timeout] }), { history: { runs } });
        assert.equal(report.counts.flaky, 1);
        assert.equal(report.decision, "SAFE TO MERGE");
    });

    it("warns when classifying without AI and when git data is missing", () => {
        const report = analyzeRelease(diff({ newFailures: [f("tests/a.spec.ts")] }), {
            changes: { files: [], warning: "No base ref given" },
        });
        assert.ok(report.warnings.some((w) => w.includes("No base ref")));
        assert.ok(report.warnings.some((w) => w.includes("no AI analysis")));
    });

    it("is deterministic", () => {
        const input = diff({ newFailures: [f("tests/login.spec.ts"), flakyNoise] });
        assert.deepEqual(analyzeRelease(input), analyzeRelease(input));
    });
});

describe("formatReleaseComment", () => {
    it("neutralizes HTML, mentions and backticks from test output", () => {
        const report = analyzeRelease(
            diff({ newFailures: [f("tests/x.spec.ts", { title: "<img src=x> ping @octocat", errorMessage: "boom `code`" })] })
        );
        const md = formatReleaseComment(report);
        assert.doesNotMatch(md, /<img/);
        assert.doesNotMatch(md, /@octocat/);
    });

    it("renders a clean SAFE summary", () => {
        const md = formatReleaseComment(analyzeRelease(diff()), undefined, { commit: "" });
        assert.match(md, /✅ SAFE TO MERGE/);
        assert.match(md, /No new failures/);
        assert.doesNotMatch(md, /Classification/);
    });
});

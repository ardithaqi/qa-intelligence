import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiffResult, Failure } from "../lib/types";
import { analyzeRelease } from "./analyzeRelease";
import { decideRelease } from "./decision";
import { formatReleaseComment, GUARDIAN_COMMENT_HEADER, shortReason, verdictAlert } from "./format";
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

    it("groups the same error across tests, but not different values", () => {
        const same = groupFailures([
            classified("regression", { failure: f("tests/a.spec.ts", { errorMessage: "Expected: \"dashboard\"\nReceived: \"login\"" }) }),
            classified("regression", { failure: f("tests/b.spec.ts", { errorMessage: "Expected: \"dashboard\"\nReceived: \"login\"" }) }),
        ]);
        assert.equal(same.length, 1);
        assert.equal(same[0].rootCauseKind, "error_signature");

        const different = groupFailures([
            classified("regression", { failure: f("tests/a.spec.ts", { errorMessage: "Expected: \"cart-1\"\nReceived: \"0\"" }) }),
            classified("regression", { failure: f("tests/b.spec.ts", { errorMessage: "Expected: \"orders-3\"\nReceived: \"2\"" }) }),
        ]);
        assert.equal(different.length, 2);
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
        assert.match(md, /> \[!CAUTION\]\n> \*\*BLOCK\*\* · CRITICAL risk \(100\/100\)/);
        assert.match(md, /248 tests · 5 new failures · 1 still failing from main · 1 fixed/);
        // The three session failures are one problem line, not three.
        assert.match(md, /<summary><b>Regression<\/b> · 3 tests · expected \/dashboard, got \/login · likely cause <code>src\/auth\/session\.ts<\/code><\/summary>/);
        assert.match(md, /commit `82fa7d0` "Persist session token in storage"/);
        assert.equal((md.match(/<summary>/g) ?? []).length, 4, "3 problems + More");
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

    it("a test flaky on main and in the PR is 'flaky on main too', not still failing", () => {
        const flaky = f("tests/search.spec.ts", { is_flaky_suspected: true });
        const report = analyzeRelease(diff({ newFailures: [f("tests/checkout.spec.ts")], unchangedFailures: [flaky] }));
        assert.equal(report.preExistingCount, 0);
        assert.equal(report.preExistingFlakyCount, 1);
        const md = formatReleaseComment(report);
        assert.doesNotMatch(md, /still failing from main/i);
        assert.match(md, /1 flaky on main too/);
        assert.match(md, /<summary>Flaky on main too \(1\)<\/summary>/);
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
        assert.match(md, /### SAFE TO MERGE\n/);
        assert.doesNotMatch(md, /risk/i, "no risk score on a safe PR");
        assert.equal((md.match(/<summary>/g) ?? []).length, 0, "nothing to expand");
    });

    it("all-green with totals is just the verdict and one line", () => {
        const report = analyzeRelease(diff(), { runSummary: { total: 248, passed: 248, failed: 0, flaky: 0, skipped: 0 } });
        const md = formatReleaseComment(report, undefined, { commit: "" });
        assert.equal(md, "## AI Release Guardian\n\n### SAFE TO MERGE\n\n<sub>all 248 tests passed</sub>\n\n");
    });

    it("safe with a flaky test is a yellow box, says SAFE once and shows no score", () => {
        const md = formatReleaseComment(analyzeRelease(diff({ newFailures: [flakyNoise] })), undefined, { commit: "" });
        assert.match(md, /> \[!WARNING\]\n> \*\*SAFE TO MERGE\*\*\n>\n> No regressions\. Only 1 flaky test, which doesn't block\./);
        assert.equal((md.match(/SAFE TO MERGE/g) ?? []).length, 1);
        assert.doesNotMatch(md, /risk|score/i);
    });

    it("picks the alert colour from the decision", () => {
        const regression = f("tests/checkout.spec.ts", { title: "cart" });
        assert.equal(verdictAlert(analyzeRelease(diff())), null, "clean: no box");
        assert.equal(verdictAlert(analyzeRelease(diff({ unchangedFailures: [regression] }))), null, "only main's failures: no box");
        assert.equal(verdictAlert(analyzeRelease(diff({ newFailures: [infraNoise] }))), "WARNING");
        assert.equal(verdictAlert(analyzeRelease(diff({ newFailures: [f("tests/x.spec.ts", { errorMessage: "Test timeout of 30000ms exceeded.", failure_type: "timeout" })] }))), "IMPORTANT");
        assert.equal(verdictAlert(analyzeRelease(diff({ newFailures: [regression] }))), "CAUTION");
    });

    it("expanded details show the error up to Playwright's call log", () => {
        const failure = f("tests/checkout.spec.ts", {
            errorMessage: 'Error: expect(locator).toHaveText(expected) failed\n\nExpected: "30"\nReceived: "20"\n\nCall log:\n  - waiting for locator',
        });
        const md = formatReleaseComment(analyzeRelease(diff({ newFailures: [failure] })), undefined, { commit: "" });
        assert.match(md, /```\nError: expect\(locator\)\.toHaveText\(expected\) failed\nExpected: "30"\nReceived: "20"\n```/);
        assert.doesNotMatch(md, /Call log/);
    });

    it("keeps the score breakdown out of the comment and lists main's failures and fixes compactly", () => {
        const report = analyzeRelease(
            diff({ newFailures: [f("tests/checkout.spec.ts")], unchangedFailures: [f("tests/legacy.spec.ts")], fixedFailures: [f("tests/old.spec.ts")] }),
            { changes: { files: [], warning: "No base ref given (--base); likely-source attribution skipped." } }
        );
        const md = formatReleaseComment(report, diff({ fixedFailures: [f("tests/old.spec.ts")] }), { commit: "" });
        assert.doesNotMatch(md, /More:|\+40|0–29 LOW/, "no score breakdown or legend");
        assert.match(md, /<summary>Still failing from main \(1\) · Fixed by this PR \(1\)<\/summary>/);
        assert.match(md, /<sub>No base ref given/, "setup warnings stay, as a footer");
        assert.doesNotMatch(md, /no AI analysis available/, "quiet note is kept in JSON only");
        assert.ok(report.warnings.some((w) => /no AI analysis available/.test(w)));
        assert.ok(report.risk.reasons.length > 0, "breakdown still in release-report.json");
    });

    it("never writes an em dash or emoji icons", () => {
        const busy = analyzeRelease(diff({ newFailures: [f("tests/login.spec.ts", { title: "t" }), flakyNoise, infraNoise], unchangedFailures: [f("tests/legacy.spec.ts")] }));
        const text = formatReleaseComment(busy) + busy.decisionReason;
        assert.doesNotMatch(text, /\u2014/);
        assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
    });

    it("stays short with many problems: 10 lines, the rest collapsed", () => {
        const many = Array.from({ length: 15 }, (_, i) =>
            f(`tests/area${i}.spec.ts`, { errorMessage: `Error: distinct problem ${"abcdefghijklmno"[i]}` })
        );
        const md = formatReleaseComment(analyzeRelease(diff({ newFailures: many })), undefined, { commit: "" });
        const topLevel = md.split("<details><summary>…and 5 more problems</summary>")[0];
        assert.equal((topLevel.match(/<details>/g) ?? []).length, 10);
        assert.match(md, /…and 5 more problems/);
        assert.ok(md.split("\n").filter((l) => l.startsWith("<details>")).length >= 15);
    });

    it("links tests and causes to the exact lines on GitHub", () => {
        const report = analyzeRelease(diff({ newFailures: [f("tests/checkout.spec.ts", { line: 12, title: "cart total" })] }), {
            changes: { files: [{ path: "src/checkout/cart.ts", commit: "abc1234ffff" }] },
        });
        const md = formatReleaseComment(report, undefined, {
            commit: "",
            links: { server: "https://github.com", repo: "acme/shop", sha: "deadbeef", testPathPrefix: "playwright/" },
            runUrl: "https://github.com/acme/shop/actions/runs/1",
        });
        assert.match(md, /\(https:\/\/github\.com\/acme\/shop\/blob\/deadbeef\/playwright\/tests\/checkout\.spec\.ts#L12\)/);
        assert.match(md, /\(https:\/\/github\.com\/acme\/shop\/blob\/deadbeef\/src\/checkout\/cart\.ts\)/);
        assert.match(md, /\[CI run\]\(https:\/\/github\.com\/acme\/shop\/actions\/runs\/1\)/);
    });
});

describe("shortReason", () => {
    const cases: [Partial<Failure>, string][] = [
        [{ errorMessage: 'Timed out 300ms waiting for expect(locator).toHaveText(expected)\nExpected: "30"\nReceived: "20"' }, 'expected "30", got "20"'],
        [{ errorMessage: "Expected: visible\nReceived: <element(s) not found>" }, "element not found"],
        [{ errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at http://x" }, "can't reach server (ERR_CONNECTION_REFUSED)"],
        [{ errorMessage: "locator.click: Error: strict mode violation: getByRole('button') resolved to 2 elements:" }, "locator matches 2 elements"],
        [{ errorMessage: "Test timeout of 30000ms exceeded." }, "timed out after 30s"],
        [{ errorMessage: "Error: something odd" }, "something odd"],
        [{ is_flaky_suspected: true }, "failed, then passed on retry"],
    ];
    for (const [over, expected] of cases) {
        it(expected, () => assert.equal(shortReason(f("tests/x.spec.ts", over)), expected));
    }
});

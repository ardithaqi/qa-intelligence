import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Failure } from "../lib/types";
import { classifyFailure } from "./classify";
import type { Attribution } from "./types";

const base = (over: Partial<Failure> = {}): Failure => ({
    file: "tests/login.spec.ts",
    line: 10,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 60,
    retry: 1,
    errorMessage: "expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500",
    source: "heuristic",
    ...over,
});

const sourceAttr: Attribution = {
    path: "src/auth/session.ts",
    kind: "naming",
    confidence: 55,
    evidence: 'Changed file shares "session" with the failing test.',
};

describe("classifyFailure", () => {
    it("flaky when it passed on retry, stronger with history", () => {
        const plain = classifyFailure({ failure: base({ is_flaky_suspected: true }), lifecycle: "new" });
        assert.equal(plain.category, "flaky");

        const withHistory = classifyFailure({
            failure: base({ is_flaky_suspected: true, project: "webkit" }),
            lifecycle: "new",
            history: { testFile: "tests/login.spec.ts", failCount: 12, totalRuns: 20, failRate: 0.6 },
        });
        assert.equal(withHistory.category, "flaky");
        assert.ok(withHistory.confidence > plain.confidence);
        assert.ok(withHistory.reasons.some((r) => r.includes("12 of the last 20")));
        assert.ok(withHistory.reasons[0].includes("webkit"));
    });

    it("infrastructure for network / browser startup errors", () => {
        const r = classifyFailure({
            failure: base({ errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000" }),
            lifecycle: "new",
        });
        assert.equal(r.category, "infrastructure");
        assert.ok(r.confidence >= 80);
    });

    it("test_issue for strict-mode violations and syntax errors", () => {
        for (const errorMessage of [
            "locator.click: Error: strict mode violation: getByRole('button') resolved to 2 elements",
            "SyntaxError: Unexpected token '}'",
        ]) {
            assert.equal(classifyFailure({ failure: base({ errorMessage }), lifecycle: "new" }).category, "test_issue");
        }
    });

    it("test_issue when only the test file changed and its locator broke", () => {
        const r = classifyFailure({
            failure: base({ failure_type: "selector_not_found", errorMessage: "Expected: visible\nReceived: <element(s) not found>" }),
            lifecycle: "new",
            attribution: { path: "playwright/tests/login.spec.ts", kind: "test_file", confidence: 50, evidence: "x" },
        });
        assert.equal(r.category, "test_issue");
    });

    it("regression for a new deterministic assertion failure; related change raises confidence", () => {
        const without = classifyFailure({ failure: base(), lifecycle: "new" });
        const withChange = classifyFailure({ failure: base(), lifecycle: "new", attribution: sourceAttr });
        assert.equal(without.category, "regression");
        assert.equal(withChange.category, "regression");
        assert.ok(withChange.confidence > without.confidence);
        assert.ok(withChange.confidence >= 70, "attributed, retried regression should be blocking-grade");
        assert.ok(without.confidence < 70, "unattributed regression alone should not be blocking-grade");
    });

    it("lower confidence when there were no retries", () => {
        const retried = classifyFailure({ failure: base({ retry: 1 }), lifecycle: "new" });
        const once = classifyFailure({ failure: base({ retry: 0 }), lifecycle: "new" });
        assert.ok(once.confidence < retried.confidence);
        assert.ok(once.reasons.some((r) => r.includes("no retries")));
    });

    it("a timeout with no other evidence is unknown, not a regression", () => {
        const r = classifyFailure({
            failure: base({ failure_type: "timeout", errorMessage: "Test timeout of 30000ms exceeded." }),
            lifecycle: "new",
        });
        assert.equal(r.category, "unknown");
    });

    it("a timeout in a historically intermittent test is flaky", () => {
        const r = classifyFailure({
            failure: base({ failure_type: "timeout", errorMessage: "Test timeout of 30000ms exceeded." }),
            lifecycle: "new",
            history: { testFile: "tests/login.spec.ts", failCount: 4, totalRuns: 10, failRate: 0.4 },
        });
        assert.equal(r.category, "flaky");
    });

    it("pre-existing failures are labelled as such", () => {
        const r = classifyFailure({ failure: base(), lifecycle: "existing" });
        assert.equal(r.category, "regression");
        assert.ok(r.reasons[0].includes("base branch"));
    });

    it("AI agreement adds a little confidence and says so", () => {
        const heuristic = classifyFailure({ failure: base(), lifecycle: "new" });
        const ai = classifyFailure({ failure: base({ source: "ai", confidence: 92 }), lifecycle: "new" });
        assert.ok(ai.confidence > heuristic.confidence);
        assert.ok(ai.reasons.some((r) => r.startsWith("AI analysis agrees")));
    });

    it("never reports 100% confidence", () => {
        const r = classifyFailure({
            failure: base({ is_flaky_suspected: true }),
            lifecycle: "new",
            history: { testFile: "tests/login.spec.ts", failCount: 19, totalRuns: 20, failRate: 0.95 },
        });
        assert.ok(r.confidence < 100);
    });
});

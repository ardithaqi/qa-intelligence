import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
    formatClearDiffComment,
    formatDiffComment,
    hasFailureChanges,
} from "./format";
import { DiffResult } from "./types";

const baseFailure = {
    file: "tests/login.spec.ts",
    line: 10,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 95,
};

describe("hasFailureChanges", () => {
    it("returns false for empty diff", () => {
        assert.equal(hasFailureChanges({ newFailures: [], unchangedFailures: [], fixedFailures: [] }), false);
    });

    it("returns true when any bucket has failures", () => {
        assert.equal(
            hasFailureChanges({
                newFailures: [baseFailure],
                unchangedFailures: [],
                fixedFailures: [],
            }),
            true
        );
    });

    it("returns true when only flaky watchlist has entries", () => {
        assert.equal(
            hasFailureChanges({
                newFailures: [],
                unchangedFailures: [],
                fixedFailures: [],
                flakyWatchlist: [
                    {
                        testFile: "tests/flaky.spec.ts",
                        failCount: 3,
                        totalRuns: 5,
                        failRate: 0.6,
                    },
                ],
            }),
            true
        );
    });
});

describe("formatClearDiffComment", () => {
    afterEach(() => {
        delete process.env.GITHUB_SHA;
    });

    it("renders an all-clear summary", () => {
        process.env.GITHUB_SHA = "c76b6b2deadbeef";

        const body = formatClearDiffComment();

        assert.match(body, /## AI Failure Diff Summary/);
        assert.match(body, /Commit: c76b6b2/);
        assert.match(body, /All tests passed/);
        assert.doesNotMatch(body, /### New Issues/);
    });
});

describe("formatDiffComment", () => {
    afterEach(() => {
        delete process.env.GITHUB_SHA;
    });

    it("groups flaky new failures separately from blocking new failures", () => {
        const diff: DiffResult = {
            newFailures: [
                baseFailure,
                {
                    ...baseFailure,
                    file: "tests/checkout.spec.ts",
                    is_flaky_suspected: true,
                },
            ],
            unchangedFailures: [],
            fixedFailures: [],
        };

        const body = formatDiffComment(diff);

        assert.match(body, /### New Issues \(1\)/);
        assert.match(body, /tests\/login\.spec\.ts:10/);
        assert.match(body, /### Flaky \(1\)/);
        assert.match(body, /tests\/checkout\.spec\.ts:10/);
        assert.doesNotMatch(body, /### Flaky \(1\)[\s\S]*severity:/);
    });

    it("includes recurrence suffix for repeat failures", () => {
        const diff: DiffResult = {
            newFailures: [
                {
                    ...baseFailure,
                    occurrence_count: 3,
                    first_seen: "2026-01-15T10:00:00.000Z",
                },
            ],
            unchangedFailures: [],
            fixedFailures: [],
        };

        const body = formatDiffComment(diff);

        assert.match(body, /3rd time since 2026-01-15/);
    });

    it("warns when pre-existing failures remain", () => {
        const diff: DiffResult = {
            newFailures: [],
            unchangedFailures: [baseFailure],
            fixedFailures: [],
        };

        const body = formatDiffComment(diff);

        assert.match(body, /Pre-existing failures/);
        assert.match(body, /### Still Failing \(1\)/);
    });

    it("includes commit sha when GITHUB_SHA is set", () => {
        process.env.GITHUB_SHA = "abc1234567890";

        const body = formatDiffComment({
            newFailures: [],
            unchangedFailures: [],
            fixedFailures: [baseFailure],
        });

        assert.match(body, /Commit: abc1234/);
        assert.match(body, /### Fixed Issues \(1\)/);
    });

    it("renders flaky watchlist section", () => {
        const body = formatDiffComment({
            newFailures: [],
            unchangedFailures: [],
            fixedFailures: [],
            flakyWatchlist: [
                {
                    testFile: "tests/checkout.spec.ts",
                    failCount: 4,
                    totalRuns: 10,
                    failRate: 0.4,
                },
            ],
        });

        assert.match(body, /### Flaky Watchlist \(1\)/);
        assert.match(
            body,
            /tests\/checkout\.spec\.ts — unstable in 4 of last 10 CI runs/
        );
    });
});

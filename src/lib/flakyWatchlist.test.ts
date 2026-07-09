import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    computeFlakyWatchlist,
    filterWatchlistForCurrentDiff,
    testFileFromFailureKey,
} from "./flakyWatchlist";
import type { FlakyWatchlistEntry, History } from "./types";

function run(failureKeys: string[], sha = "abc"): History["runs"][number] {
    return {
        sha,
        timestamp: new Date().toISOString(),
        failureKeys,
    };
}

describe("testFileFromFailureKey", () => {
    it("strips failure type suffix", () => {
        assert.equal(
            testFileFromFailureKey("tests/login.spec.ts:assertion_mismatch"),
            "tests/login.spec.ts"
        );
    });
});

describe("computeFlakyWatchlist", () => {
    it("returns empty when history is too short", () => {
        const history: History = {
            runs: [
                run(["tests/a.spec.ts:timeout"]),
                run(["tests/a.spec.ts:timeout"]),
            ],
        };

        assert.deepEqual(computeFlakyWatchlist(history), []);
    });

    it("lists tests that fail intermittently across runs", () => {
        const history: History = {
            runs: [
                run(["tests/flaky.spec.ts:timeout"], "1"),
                run([], "2"),
                run(["tests/flaky.spec.ts:timeout"], "3"),
                run([], "4"),
            ],
        };

        const watchlist = computeFlakyWatchlist(history);

        assert.equal(watchlist.length, 1);
        assert.equal(watchlist[0].testFile, "tests/flaky.spec.ts");
        assert.equal(watchlist[0].failCount, 2);
        assert.equal(watchlist[0].totalRuns, 4);
        assert.equal(watchlist[0].failRate, 0.5);
    });

    it("excludes tests that fail every run", () => {
        const history: History = {
            runs: [
                run(["tests/broken.spec.ts:timeout"], "1"),
                run(["tests/broken.spec.ts:timeout"], "2"),
                run(["tests/broken.spec.ts:timeout"], "3"),
            ],
        };

        assert.deepEqual(computeFlakyWatchlist(history), []);
    });

    it("excludes tests that only failed once", () => {
        const history: History = {
            runs: [run([], "1"), run([], "2"), run(["tests/once.spec.ts:timeout"], "3")],
        };

        assert.deepEqual(computeFlakyWatchlist(history), []);
    });

    it("counts a test once per run even with multiple failure types", () => {
        const history: History = {
            runs: [
                run(
                    [
                        "tests/multi.spec.ts:timeout",
                        "tests/multi.spec.ts:assertion_mismatch",
                    ],
                    "1"
                ),
                run([], "2"),
                run(["tests/multi.spec.ts:timeout"], "3"),
            ],
        };

        const [entry] = computeFlakyWatchlist(history, { minFailCount: 2 });

        assert.equal(entry.testFile, "tests/multi.spec.ts");
        assert.equal(entry.failCount, 2);
    });
});

describe("filterWatchlistForCurrentDiff", () => {
    const entry: FlakyWatchlistEntry = {
        testFile: "tests/login.spec.ts",
        failCount: 3,
        totalRuns: 8,
        failRate: 0.375,
    };

    it("excludes tests still failing on this PR", () => {
        const filtered = filterWatchlistForCurrentDiff([entry], {
            newFailures: [],
            unchangedFailures: [
                {
                    file: "tests/login.spec.ts",
                    line: 10,
                    failure_type: "assertion_mismatch",
                    severity: "medium",
                    confidence: 95,
                },
            ],
        });

        assert.deepEqual(filtered, []);
    });

    it("excludes new non-flaky failures on this PR", () => {
        const filtered = filterWatchlistForCurrentDiff([entry], {
            newFailures: [
                {
                    file: "tests/login.spec.ts",
                    line: 10,
                    failure_type: "assertion_mismatch",
                    severity: "medium",
                    confidence: 95,
                },
            ],
            unchangedFailures: [],
        });

        assert.deepEqual(filtered, []);
    });

    it("keeps entries when only flaky new failures overlap", () => {
        const filtered = filterWatchlistForCurrentDiff([entry], {
            newFailures: [
                {
                    file: "tests/login.spec.ts",
                    line: 10,
                    failure_type: "assertion_mismatch",
                    severity: "medium",
                    confidence: 95,
                    is_flaky_suspected: true,
                },
            ],
            unchangedFailures: [],
        });

        assert.deepEqual(filtered, [entry]);
    });
});

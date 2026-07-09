import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
    computeDiff,
    enrichDiffWithHistory,
    formatDiffComment,
    hasFailureChanges,
} from "./index";

describe("programmatic API", () => {
    it("exports core functions from package entry", () => {
        assert.equal(typeof computeDiff, "function");
        assert.equal(typeof formatDiffComment, "function");
        assert.equal(typeof hasFailureChanges, "function");
        assert.equal(typeof enrichDiffWithHistory, "function");
    });

    it("computeDiff returns empty buckets for missing dirs", () => {
        const diff = computeDiff("missing-baseline", "missing-current");

        assert.deepEqual(diff.newFailures, []);
        assert.deepEqual(diff.unchangedFailures, []);
        assert.deepEqual(diff.fixedFailures, []);
        assert.deepEqual(diff.blockingFailures, []);
    });

    it("formatDiffComment renders diff summary", () => {
        const body = formatDiffComment({
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
            fixedFailures: [],
        });

        assert.match(body, /## AI Failure Diff Summary/);
        assert.match(body, /New Issues \(1\)/);
    });

    it("enrichDiffWithHistory persists recurrence and updates cache", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-intel-"));
        const historyPath = path.join(tmpDir, "cache", "failure-history.json");
        const failure = {
            file: "tests/login.spec.ts",
            line: 10,
            failure_type: "assertion_mismatch",
            severity: "medium",
            confidence: 95,
        };

        const enriched = enrichDiffWithHistory(
            { newFailures: [failure], unchangedFailures: [], fixedFailures: [] },
            historyPath,
            { sha: "abc123", timestamp: "2026-06-01T00:00:00.000Z" }
        );

        assert.equal(enriched.newFailures[0]?.occurrence_count, 1);
        assert.equal(
            enriched.newFailures[0]?.first_seen,
            "2026-06-01T00:00:00.000Z"
        );
        assert.ok(fs.existsSync(historyPath));

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
    MAX_RUNS,
    appendHistoryRun,
    enrichDiffWithHistory,
    enrichFailures,
    failureKey,
    loadHistory,
    saveHistory,
    type Failure,
    type History,
    type RunRecord,
} from "./history";

const sampleFailure: Failure = {
    file: "tests/login.spec.ts",
    line: 10,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 95,
};

describe("failureKey", () => {
    it("matches failureDiffKey format", () => {
        assert.equal(
            failureKey(sampleFailure),
            "tests/login.spec.ts:assertion_mismatch"
        );
    });
});

describe("enrichFailures", () => {
    it("marks first occurrence", () => {
        const history: History = { runs: [] };
        const thisRun: RunRecord = {
            sha: "abc",
            timestamp: "2026-06-01T00:00:00.000Z",
            failureKeys: [failureKey(sampleFailure)],
        };

        const [enriched] = enrichFailures([sampleFailure], history, thisRun);

        assert.equal(enriched.occurrence_count, 1);
        assert.equal(enriched.first_seen, "2026-06-01T00:00:00.000Z");
    });

    it("counts prior runs plus current run", () => {
        const key = failureKey(sampleFailure);
        const history: History = {
            runs: [
                {
                    sha: "old1",
                    timestamp: "2026-05-01T00:00:00.000Z",
                    failureKeys: [key],
                },
                {
                    sha: "old2",
                    timestamp: "2026-05-15T00:00:00.000Z",
                    failureKeys: [],
                },
                {
                    sha: "old3",
                    timestamp: "2026-06-01T00:00:00.000Z",
                    failureKeys: [key],
                },
            ],
        };
        const thisRun: RunRecord = {
            sha: "new",
            timestamp: "2026-06-20T00:00:00.000Z",
            failureKeys: [key],
        };

        const [enriched] = enrichFailures([sampleFailure], history, thisRun);

        assert.equal(enriched.occurrence_count, 3);
        assert.equal(enriched.first_seen, "2026-05-01T00:00:00.000Z");
    });

    it("leaves failures without history unenriched", () => {
        const history: History = { runs: [] };
        const thisRun: RunRecord = {
            sha: "abc",
            timestamp: "2026-06-01T00:00:00.000Z",
            failureKeys: [],
        };

        const [enriched] = enrichFailures([sampleFailure], history, thisRun);

        assert.equal(enriched.occurrence_count, undefined);
        assert.equal(enriched.first_seen, undefined);
    });
});

describe("appendHistoryRun", () => {
    it(`keeps only the last ${MAX_RUNS} runs`, () => {
        const history: History = {
            runs: Array.from({ length: MAX_RUNS }, (_, i) => ({
                sha: `sha-${i}`,
                timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
                failureKeys: [],
            })),
        };

        const updated = appendHistoryRun(history, {
            sha: "new-sha",
            timestamp: "2026-06-26T00:00:00.000Z",
            failureKeys: ["tests/login.spec.ts:assertion_mismatch"],
        });

        assert.equal(updated.runs.length, MAX_RUNS);
        assert.equal(updated.runs[0].sha, "sha-1");
        assert.equal(updated.runs.at(-1)?.sha, "new-sha");
    });
});

describe("saveHistory and enrichDiffWithHistory", () => {
    it("round-trips history through save and load", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-intel-"));
        const historyPath = path.join(tmpDir, "cache", "failure-history.json");
        const history: History = {
            runs: [
                {
                    sha: "abc",
                    timestamp: "2026-06-01T00:00:00.000Z",
                    failureKeys: [failureKey(sampleFailure)],
                },
            ],
        };

        saveHistory(historyPath, history);
        assert.deepEqual(loadHistory(historyPath), history);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("enriches diff buckets and appends a run", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-intel-"));
        const historyPath = path.join(tmpDir, "failure-history.json");

        const enriched = enrichDiffWithHistory(
            {
                newFailures: [sampleFailure],
                unchangedFailures: [],
                fixedFailures: [],
            },
            historyPath,
            { sha: "run-1", timestamp: "2026-06-01T00:00:00.000Z" }
        );

        assert.equal(enriched.newFailures[0]?.occurrence_count, 1);
        assert.equal(loadHistory(historyPath).runs.length, 1);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});

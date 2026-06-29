import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { computeDiff } from "./computeDiff";
import { writeFailureArtifact } from "../test/writeFailureArtifact";

function withTempDirs(fn: (baseline: string, current: string) => void) {
    const baseline = fs.mkdtempSync(path.join(os.tmpdir(), "qa-baseline-"));
    const current = fs.mkdtempSync(path.join(os.tmpdir(), "qa-current-"));

    try {
        fn(baseline, current);
    } finally {
        fs.rmSync(baseline, { recursive: true, force: true });
        fs.rmSync(current, { recursive: true, force: true });
    }
}

describe("computeDiff", () => {
    it("classifies new, unchanged, fixed, and blocking failures", () => {
        withTempDirs((baseline, current) => {
            writeFailureArtifact(
                baseline,
                "login.spec.ts",
                "still_failing",
                0,
                {
                    file: "tests/login.spec.ts",
                    line: 10,
                    failure_type: "assertion_mismatch",
                    severity: "medium",
                    confidence: 90,
                }
            );
            writeFailureArtifact(
                baseline,
                "checkout.spec.ts",
                "fixed_test",
                0,
                {
                    file: "tests/checkout.spec.ts",
                    line: 5,
                    failure_type: "timeout",
                    severity: "high",
                    confidence: 88,
                }
            );

            writeFailureArtifact(
                current,
                "login.spec.ts",
                "still_failing",
                0,
                {
                    file: "tests/login.spec.ts",
                    line: 10,
                    failure_type: "assertion_mismatch",
                    severity: "medium",
                    confidence: 92,
                }
            );
            writeFailureArtifact(
                current,
                "signup.spec.ts",
                "new_failure",
                0,
                {
                    file: "tests/signup.spec.ts",
                    line: 20,
                    failure_type: "selector_not_found",
                    severity: "medium",
                    confidence: 85,
                }
            );
            writeFailureArtifact(
                current,
                "profile.spec.ts",
                "flaky_failure",
                1,
                {
                    file: "tests/profile.spec.ts",
                    line: 8,
                    failure_type: "timeout",
                    severity: "low",
                    confidence: 70,
                    is_flaky_suspected: true,
                }
            );

            const diff = computeDiff(baseline, current);

            assert.equal(diff.newFailures.length, 2);
            assert.equal(diff.unchangedFailures.length, 1);
            assert.equal(diff.fixedFailures.length, 1);
            assert.equal(diff.blockingFailures.length, 1);
            assert.equal(diff.blockingFailures[0].file, "tests/signup.spec.ts");
            assert.equal(
                diff.newFailures.some((f) => f.is_flaky_suspected),
                true
            );
            assert.equal(diff.fixedFailures[0].file, "tests/checkout.spec.ts");
        });
    });

    it("prefers the highest retry attempt for the same failure key", () => {
        withTempDirs((_baseline, current) => {
            writeFailureArtifact(
                current,
                "login.spec.ts",
                "retry_test",
                0,
                {
                    file: "tests/login.spec.ts",
                    line: 10,
                    failure_type: "assertion_mismatch",
                    severity: "medium",
                    confidence: 50,
                }
            );
            writeFailureArtifact(
                current,
                "login.spec.ts",
                "retry_test",
                2,
                {
                    file: "tests/login.spec.ts",
                    line: 10,
                    failure_type: "assertion_mismatch",
                    severity: "medium",
                    confidence: 99,
                    is_flaky_suspected: true,
                }
            );

            const diff = computeDiff(path.join(current, "empty"), current);

            assert.equal(diff.newFailures.length, 1);
            assert.equal(diff.newFailures[0].confidence, 99);
            assert.equal(diff.newFailures[0].is_flaky_suspected, true);
        });
    });

    it("returns empty buckets when artifact dirs are missing", () => {
        withTempDirs((baseline, current) => {
            const diff = computeDiff(baseline, current);

            assert.deepEqual(diff.newFailures, []);
            assert.deepEqual(diff.unchangedFailures, []);
            assert.deepEqual(diff.fixedFailures, []);
            assert.deepEqual(diff.blockingFailures, []);
        });
    });
});

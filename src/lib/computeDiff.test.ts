import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { computeDiff, extractAiNote } from "./computeDiff";
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

    it("prefers metadata file over hallucinated AI file on flaky pass attempts", () => {
        withTempDirs((_baseline, current) => {
            const dir = path.join(
                current,
                "flaky.spec.ts",
                "flaky_demo",
                "attempt-1"
            );
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, "meta.json"),
                JSON.stringify(
                    {
                        file: "/repo/tests/examples/saucedemo/flaky.spec.ts",
                        line: 8,
                        is_flaky_suspected: true,
                    },
                    null,
                    2
                )
            );
            fs.writeFileSync(
                path.join(dir, "ai.txt"),
                [
                    "hallucinated analysis",
                    JSON.stringify({
                        file: "tests/example.test.js",
                        line: 10,
                        failure_type: "assertion_mismatch",
                        severity: "medium",
                        confidence: 95,
                        is_flaky_suspected: true,
                    }),
                ].join("\n")
            );

            const diff = computeDiff(path.join(current, "empty"), current);

            assert.equal(diff.newFailures.length, 1);
            assert.equal(
                diff.newFailures[0].file,
                "tests/examples/saucedemo/flaky.spec.ts"
            );
            assert.equal(diff.newFailures[0].line, 8);
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

    it("reads meta.json directly when there is no AI analysis", () => {
        withTempDirs((baseline, current) => {
            const writeMeta = (spec: string, title: string, attempt: number, meta: object) => {
                const dir = path.join(current, spec, title, `attempt-${attempt}`);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
            };

            writeMeta("login.spec.ts", "logs_in", 0, {
                title: "logs in",
                file: "/repo/playwright/tests/login.spec.ts",
                line: 12,
                errorMessage: "\x1b[31mexpect(received).toBe(expected)\x1b[39m\nExpected: 200\nReceived: 500",
                project: "webkit",
                retry: 0,
                url: "https://app.test/login",
                is_flaky_suspected: false,
                severity: "medium",
            });
            // Retry passed: highest attempt wins and marks it flaky.
            writeMeta("search.spec.ts", "finds", 0, { file: "tests/search.spec.ts", line: 3, errorMessage: "Test timeout of 30000ms exceeded.", retry: 0 });
            writeMeta("search.spec.ts", "finds", 1, { file: "tests/search.spec.ts", line: 3, errorMessage: "Test timeout of 30000ms exceeded.", retry: 1, is_flaky_suspected: true, severity: "low" });

            const diff = computeDiff(baseline, current);
            const login = diff.newFailures.find((f) => f.file === "tests/login.spec.ts");
            const search = diff.newFailures.find((f) => f.file === "tests/search.spec.ts");

            assert.equal(diff.newFailures.length, 2);
            assert.equal(login?.failure_type, "assertion_mismatch");
            assert.equal(login?.source, "heuristic");
            assert.equal(login?.project, "webkit");
            assert.equal(login?.title, "logs in");
            assert.equal(login?.url, "https://app.test/login");
            assert.doesNotMatch(login?.errorMessage ?? "", /\x1b/);
            assert.equal(search?.failure_type, "timeout");
            assert.equal(search?.is_flaky_suspected, true);
            assert.deepEqual(diff.blockingFailures.map((f) => f.file), ["tests/login.spec.ts"]);
        });
    });

    it("prefers ai.txt over meta.json in the same attempt and tags the source", () => {
        withTempDirs((baseline, current) => {
            writeFailureArtifact(current, "a.spec.ts", "t", 0, {
                file: "tests/a.spec.ts",
                line: 1,
                failure_type: "selector_not_found",
                severity: "medium",
                confidence: 91,
                is_flaky_suspected: false,
            });
            const diff = computeDiff(baseline, current);
            assert.equal(diff.newFailures.length, 1);
            assert.equal(diff.newFailures[0].failure_type, "selector_not_found");
            assert.equal(diff.newFailures[0].source, "ai");
        });
    });
});

describe("computeDiff reads every AI answer or falls back", () => {
    const meta = { file: "tests/x.spec.ts", line: 3, retry: 1, errorMessage: 'Expected: "a"\nReceived: "b"' };
    const writeAttempt = (current: string, aiTxt: string) => {
        const dir = path.join(current, "x.spec.ts", "t", "attempt-1");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
        fs.writeFileSync(path.join(dir, "ai.txt"), aiTxt);
    };

    it("reads the AI's JSON when it is wrapped in a ```json fence", () => {
        withTempDirs((baseline, current) => {
            writeAttempt(current, 'SECTION 2\n```json\n{\n  "failure_type": "timeout",\n  "severity": "high",\n  "confidence": 80,\n  "is_flaky_suspected": false\n}\n```\n');
            const [f] = computeDiff(baseline, current).newFailures;
            assert.equal(f.failure_type, "timeout");
            assert.equal(f.source, "ai");
        });
    });

    it("falls back to meta.json when ai.txt can't be read, so the failure isn't lost", () => {
        withTempDirs((baseline, current) => {
            writeAttempt(current, "The model answered without any JSON.");
            const failures = computeDiff(baseline, current).newFailures;
            assert.equal(failures.length, 1);
            assert.equal(failures[0].source, "heuristic");
        });
    });
});

describe("computeDiff counts each test once", () => {
    it("keeps one record per test when its attempts were classified differently", () => {
        withTempDirs((baseline, current) => {
            // As in CI: the AI analyzed the last attempt, the first one only has meta.json,
            // which the error-text rules classify as a different type.
            const test = path.join(current, "search.spec.ts", "search_suggestions_appear");
            fs.mkdirSync(path.join(test, "attempt-0"), { recursive: true });
            fs.writeFileSync(path.join(test, "attempt-0", "meta.json"), JSON.stringify({
                file: "tests/search.spec.ts", line: 7, retry: 0, errorMessage: "Error: something odd happened",
            }));
            writeFailureArtifact(current, "search.spec.ts", "search_suggestions_appear", 1, {
                file: "tests/search.spec.ts", line: 7, failure_type: "assertion_mismatch", severity: "medium", confidence: 90,
            });

            const diff = computeDiff(baseline, current);
            assert.equal(diff.newFailures.length, 1);
            assert.equal(diff.newFailures[0].failure_type, "assertion_mismatch", "the last attempt (with AI) wins");
        });
    });

    it("still keeps two different failing tests", () => {
        withTempDirs((baseline, current) => {
            const fail = { line: 5, failure_type: "assertion_mismatch", severity: "medium", confidence: 90 };
            writeFailureArtifact(current, "checkout.spec.ts", "t", 1, { ...fail, file: "tests/checkout.spec.ts" });
            writeFailureArtifact(current, "search.spec.ts", "t", 1, { ...fail, file: "tests/search.spec.ts" });
            assert.equal(computeDiff(baseline, current).newFailures.length, 2);
        });
    });
});

describe("computeDiff with several local runs", () => {
    const fail = { file: "tests/checkout.spec.ts", line: 5, failure_type: "assertion_mismatch", severity: "medium", confidence: 90 };

    it("reads only the run marked in .current-run, so a failure fixed since then is gone", () => {
        withTempDirs((baseline, current) => {
            writeFailureArtifact(path.join(current, "run-2026-11-04T08-00-00-000Z"), "checkout.spec.ts", "t", 0, fail);
            fs.mkdirSync(path.join(current, "run-2026-11-04T09-00-00-000Z"));
            // globalSetup writes the path relative to where Playwright started.
            fs.writeFileSync(path.join(current, ".current-run"), "artifacts/run-2026-11-04T09-00-00-000Z");
            assert.equal(computeDiff(baseline, current).newFailures.length, 0);
        });
    });

    it("reads every run when there's no marker (merged CI artifact from sharded runs)", () => {
        withTempDirs((baseline, current) => {
            writeFailureArtifact(path.join(current, "run-a"), "checkout.spec.ts", "t", 0, fail);
            writeFailureArtifact(path.join(current, "run-b"), "search.spec.ts", "t", 0, { ...fail, file: "tests/search.spec.ts" });
            assert.equal(computeDiff(baseline, current).newFailures.length, 2);
        });
    });
});

describe("extractAiNote", () => {
    it("takes the observed line from the AI's root cause section", () => {
        const content = "File: tests/a.spec.ts\n\nRoot cause:\nLine 1: compares #total to 30.\nLine 2: The element stayed \"20\" for the whole timeout.\nLine 3: assertion_mismatch.\n\n{}";
        assert.equal(extractAiNote(content), 'The element stayed "20" for the whole timeout.');
    });

    it("returns nothing when the section is missing", () => {
        assert.equal(extractAiNote("{\"failure_type\":\"timeout\"}"), undefined);
    });
});

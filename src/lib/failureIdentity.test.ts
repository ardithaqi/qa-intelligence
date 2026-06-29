import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    failureDiffKey,
    normalizeTestPath,
    parseAttemptFromAiPath,
    parseLocationFromStack,
} from "./failureIdentity";

describe("normalizeTestPath", () => {
    it("extracts path from absolute Windows-style paths", () => {
        assert.equal(
            normalizeTestPath("C:\\repo\\playwright\\tests\\login.spec.ts"),
            "tests/login.spec.ts"
        );
    });

    it("prefixes bare filenames with tests/", () => {
        assert.equal(normalizeTestPath("login.spec.ts"), "tests/login.spec.ts");
    });

    it("keeps paths that already start at tests/", () => {
        assert.equal(
            normalizeTestPath("tests/checkout.spec.ts"),
            "tests/checkout.spec.ts"
        );
    });
});

describe("parseLocationFromStack", () => {
    it("parses file and line from stack trace", () => {
        const stack =
            "Error: expect(received).toBe(expected)\n    at tests/login.spec.ts:42:7";

        assert.deepEqual(parseLocationFromStack(stack), {
            file: "tests/login.spec.ts",
            line: 42,
        });
    });

    it("returns null for missing or unparseable stack", () => {
        assert.equal(parseLocationFromStack(undefined), null);
        assert.equal(parseLocationFromStack("no test path here"), null);
    });
});

describe("failureDiffKey", () => {
    it("combines normalized file and failure type", () => {
        assert.equal(
            failureDiffKey("tests/login.spec.ts", "assertion_mismatch"),
            "tests/login.spec.ts:assertion_mismatch"
        );
    });
});

describe("parseAttemptFromAiPath", () => {
    it("reads attempt number from artifact path", () => {
        assert.equal(
            parseAttemptFromAiPath(
                "artifacts/run/login.spec.ts/user_login/attempt-2/ai.txt"
            ),
            2
        );
    });

    it("defaults to 0 when attempt segment is missing", () => {
        assert.equal(parseAttemptFromAiPath("artifacts/run/ai.txt"), 0);
    });
});

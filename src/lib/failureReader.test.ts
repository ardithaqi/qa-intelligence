import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { readFailures } from "./failureReader";

function withTempDir(fn: (root: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-failure-reader-"));

    try {
        fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function writeAiTxt(root: string, name: string, content: string): void {
    const dir = path.join(root, name, "attempt-0");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ai.txt"), content);
}

const HUMAN_SECTION = [
    "File: tests/login.spec.ts",
    "Line: 10",
    "",
    "Root cause:",
    "Line 1: assertion mismatch",
    "",
].join("\n");

const RAW_JSON = JSON.stringify({
    file: "tests/login.spec.ts",
    line: 10,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 90,
});

describe("readFailures", () => {
    it("parses plain trailing JSON (no fence)", () => {
        withTempDir((root) => {
            writeAiTxt(root, "plain", HUMAN_SECTION + RAW_JSON);

            const { failures } = readFailures({ rootDir: root });

            assert.equal(failures.length, 1);
            assert.equal(failures[0].failure_type, "assertion_mismatch");
        });
    });

    it("parses JSON wrapped in a ```json markdown fence", () => {
        withTempDir((root) => {
            const content = HUMAN_SECTION + "```json\n" + RAW_JSON + "\n```\n";
            writeAiTxt(root, "fenced", content);

            const { failures } = readFailures({ rootDir: root });

            assert.equal(failures.length, 1);
            assert.equal(failures[0].failure_type, "assertion_mismatch");
            assert.equal(failures[0].confidence, 90);
        });
    });

    it("parses JSON followed by trailing prose", () => {
        withTempDir((root) => {
            const content =
                HUMAN_SECTION + RAW_JSON + "\n\nLet me know if you need anything else!";
            writeAiTxt(root, "trailing-prose", content);

            const { failures } = readFailures({ rootDir: root });

            assert.equal(failures.length, 1);
            assert.equal(failures[0].file, "tests/login.spec.ts");
        });
    });

    it("returns no failures when JSON is missing", () => {
        withTempDir((root) => {
            writeAiTxt(root, "no-json", HUMAN_SECTION);

            const { failures } = readFailures({ rootDir: root });

            assert.equal(failures.length, 0);
        });
    });
});

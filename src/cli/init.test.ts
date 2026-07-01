import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { runInit } from "../cli/init";

describe("runInit", () => {
    let tempRoot = "";

    afterEach(() => {
        if (tempRoot) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
            tempRoot = "";
        }
    });

    it("creates playwright scaffold and CI workflow", () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-"));

        const { written, skipped } = runInit({ root: tempRoot });

        assert.equal(skipped.length, 0);
        assert.ok(written.includes("playwright/playwright.config.ts"));
        assert.ok(written.includes(".github/workflows/qa-intelligence.yml"));
        assert.ok(
            fs.existsSync(path.join(tempRoot, "playwright/tests/example.spec.ts"))
        );
    });

    it("skips existing files unless force is set", () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-"));
        runInit({ root: tempRoot });

        const second = runInit({ root: tempRoot });
        assert.equal(second.written.length, 0);
        assert.ok(second.skipped.length > 0);

        const forced = runInit({ root: tempRoot, force: true });
        assert.ok(forced.written.length > 0);
    });

    it("omits CI workflow with withCi false", () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-"));

        const { written } = runInit({ root: tempRoot, withCi: false });

        assert.ok(!written.some((f) => f.includes(".github")));
        assert.ok(fs.existsSync(path.join(tempRoot, "playwright/package.json")));
    });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { runInit } from "../cli/init";

const PLAYWRIGHT_TEMPLATE_FILES = [
    "playwright/.env.example",
    "playwright/gitignore",
    "playwright/tsconfig.json",
    "playwright/playwright.config.ts",
    "playwright/package.json",
    "playwright/tests/example.spec.ts",
];

const CI_TEMPLATE_FILES = ["github/workflows/qa-intelligence.yml"];

describe("runInit", () => {
    let tempRoot = "";

    afterEach(() => {
        if (tempRoot) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
            tempRoot = "";
        }
    });

    it("all scaffold templates exist (npm must ship them)", () => {
        const templatesRoot = path.join(__dirname, "..", "..", "templates");

        for (const file of [...PLAYWRIGHT_TEMPLATE_FILES, ...CI_TEMPLATE_FILES]) {
            assert.ok(
                fs.existsSync(path.join(templatesRoot, file)),
                `missing template: ${file}`
            );
        }
    });

    it("creates playwright scaffold and CI workflow", () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-init-"));

        const { written, skipped } = runInit({ root: tempRoot });

        assert.equal(skipped.length, 0);
        assert.ok(written.includes("playwright/playwright.config.ts"));
        assert.ok(written.includes("playwright/.gitignore"));
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

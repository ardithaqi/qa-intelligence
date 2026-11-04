import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { playwrightSearchBases } from "./playwrightTest";

describe("playwrightSearchBases", () => {
    const root = "/repo";

    it("tries the running Playwright CLI first, then the config folder, cwd and playwright/", () => {
        const argv = ["node", "/repo/playwright/node_modules/@playwright/test/cli.js", "test", "-c", "playwright/playwright.config.ts"];
        assert.deepEqual(playwrightSearchBases(argv, root), [
            "/repo/playwright/node_modules/@playwright/test/cli.js",
            path.join(root, "playwright", "package.json"),
            path.join(root, "package.json"),
        ]);
    });

    it("ignores argv[1] when it isn't Playwright (e.g. node -e or a test runner)", () => {
        assert.deepEqual(playwrightSearchBases(["node", "/usr/lib/tsx/cli.mjs"], root), [
            path.join(root, "package.json"),
            path.join(root, "playwright", "package.json"),
        ]);
    });
});

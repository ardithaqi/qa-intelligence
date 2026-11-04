import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const REPO = path.resolve(__dirname, "..", "..");
const PLAYWRIGHT = path.join(REPO, "node_modules", ".bin", "playwright");
const BASE_TEST = path.join(REPO, "src", "playwright", "baseTest.ts");

const spec = (title: string, pass: boolean) => `import { test, expect } from ${JSON.stringify(BASE_TEST)};
test(${JSON.stringify(title)}, async ({ page }) => {
  await page.setContent("<h1>ok</h1>");
  await expect(page.locator("h1")).toHaveText(${JSON.stringify(pass ? "ok" : "not ok")}, { timeout: 200 });
});
`;

/** Spec files of the meta.json files recorded in the run, as "<spec> attempt-N". */
function recorded(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name === "meta.json") {
                const parts = path.relative(path.join(root, "artifacts"), full).split(path.sep);
                out.push(`${parts[1]} ${parts[3]}`);
            }
        }
    };
    walk(path.join(root, "artifacts"));
    return out.sort();
}

describe("failure recording in a real Playwright run", () => {
    it("records failures in every spec file of a worker, not just the first one loaded", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-recording-"));
        try {
            fs.writeFileSync(path.join(root, ".env"), "BASE_URL=http://localhost:3000\n");
            fs.writeFileSync(
                path.join(root, "playwright.config.ts"),
                `export default { testDir: "./tests", retries: 0, workers: 1, timeout: 10000,
                  globalSetup: ${JSON.stringify(path.join(REPO, "src", "playwright", "globalSetup.ts"))},
                  reporter: "dot" };\n`
            );
            fs.mkdirSync(path.join(root, "tests"));
            // a passes and loads the hooks first; b and c fail later in the same worker.
            fs.writeFileSync(path.join(root, "tests", "a.spec.ts"), spec("a passes", true));
            fs.writeFileSync(path.join(root, "tests", "b.spec.ts"), spec("b fails", false));
            fs.writeFileSync(path.join(root, "tests", "c.spec.ts"), spec("c fails", false));

            const run = spawnSync(PLAYWRIGHT, ["test"], {
                cwd: root,
                encoding: "utf8",
                env: { ...process.env, RELEASE_GUARDIAN_AI: "off", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
                timeout: 120_000,
            });
            assert.match(run.stdout + run.stderr, /2 failed/, run.stdout + run.stderr);
            assert.deepEqual(recorded(root), ["b.spec.ts attempt-0", "c.spec.ts attempt-0"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

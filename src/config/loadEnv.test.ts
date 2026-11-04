import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseEnv, resolveEnvFiles } from "./loadEnv";

function repo(fn: (root: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-env-"));
    try {
        fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const write = (file: string, text = "BASE_URL=https://app.test\n") => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};

describe("resolveEnvFiles", () => {
    it("finds playwright/.env when started from the repo root (VS Code extension case)", () => {
        repo((root) => {
            write(path.join(root, "playwright", ".env"));
            assert.deepEqual(resolveEnvFiles(root, [], {}), [path.join(root, "playwright", ".env")]);
        });
    });

    it("prefers the Playwright config's folder, then cwd, then playwright/", () => {
        repo((root) => {
            write(path.join(root, ".env"));
            write(path.join(root, "playwright", ".env"));
            write(path.join(root, "e2e", ".env"));
            const files = resolveEnvFiles(root, ["node", "cli.js", "test", "-c", "e2e/playwright.config.ts"], {});
            assert.deepEqual(files, [path.join(root, "e2e", ".env"), path.join(root, ".env"), path.join(root, "playwright", ".env")]);
            assert.equal(resolveEnvFiles(root, ["--config=e2e/playwright.config.ts"], {})[0], path.join(root, "e2e", ".env"));
        });
    });

    it("an explicit RELEASE_GUARDIAN_ENV_FILE comes first", () => {
        repo((root) => {
            write(path.join(root, "ci.env"));
            write(path.join(root, ".env"));
            assert.equal(resolveEnvFiles(root, [], { RELEASE_GUARDIAN_ENV_FILE: "ci.env" })[0], path.join(root, "ci.env"));
        });
    });

    it("skips files that don't exist and never lists one twice", () => {
        repo((root) => {
            write(path.join(root, ".env"));
            assert.deepEqual(resolveEnvFiles(root, ["-c", "playwright.config.ts"], {}), [path.join(root, ".env")]);
            assert.deepEqual(resolveEnvFiles(path.join(root, "nowhere"), [], {}), []);
        });
    });
});

describe("parseEnv", () => {
    it("returns typed settings with defaults", () => {
        assert.deepEqual(parseEnv({ BASE_URL: "https://app.test", PW_WORKERS: "4" }), {
            ENV: "dev",
            BASE_URL: "https://app.test",
            HEADLESS: true,
            PW_WORKERS: 4,
            PW_RETRIES: 1,
        });
    });

    it("throws a readable error instead of exiting the process", () => {
        assert.throws(
            () => parseEnv({}, ["/repo/.env"]),
            (e: Error) =>
                /Invalid environment \(BASE_URL: /.test(e.message) &&
                /playwright\/\.env/.test(e.message) &&
                /Read \.env from: \/repo\/\.env\./.test(e.message)
        );
        assert.throws(() => parseEnv({}), /No \.env file found\./);
    });
});

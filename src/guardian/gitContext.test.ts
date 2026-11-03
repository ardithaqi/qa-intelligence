import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { collectChanges } from "./gitContext";

function repo(fn: (root: string, git: (...args: string[]) => string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-git-"));
    const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
        git("init", "-q", "-b", "main");
        git("config", "user.email", "test@example.invalid");
        git("config", "user.name", "Test");
        git("config", "commit.gpgsign", "false");
        fn(root, git);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const write = (root: string, file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
};

describe("collectChanges", () => {
    it("lists PR files with their latest touching commit", () => {
        repo((root, git) => {
            write(root, "src/auth/session.ts", "v1");
            write(root, "src/other.ts", "v1");
            git("add", ".");
            git("commit", "-qm", "base");
            git("checkout", "-qb", "feature");

            write(root, "src/auth/session.ts", "v2");
            git("commit", "-qam", "first change");
            write(root, "src/auth/session.ts", "v3");
            write(root, "playwright/tests/login.spec.ts", "t");
            git("add", ".");
            git("commit", "-qm", "persist session token");
            const head = git("rev-parse", "HEAD");

            const { files, warning } = collectChanges("main", "HEAD", root);
            assert.equal(warning, undefined);
            assert.deepEqual(
                files.sort((a, b) => a.path.localeCompare(b.path)),
                [
                    { path: "playwright/tests/login.spec.ts", commit: head, commitSubject: "persist session token" },
                    { path: "src/auth/session.ts", commit: head, commitSubject: "persist session token" },
                ]
            );
        });
    });

    it("excludes base-branch changes made after the PR branched", () => {
        repo((root, git) => {
            write(root, "a.ts", "1");
            git("add", ".");
            git("commit", "-qm", "base");
            git("checkout", "-qb", "feature");
            write(root, "feature.ts", "1");
            git("add", ".");
            git("commit", "-qm", "feature");
            git("checkout", "-q", "main");
            write(root, "main-only.ts", "1");
            git("add", ".");
            git("commit", "-qm", "main moved");
            git("checkout", "-q", "feature");

            assert.deepEqual(collectChanges("main", "HEAD", root).files.map((f) => f.path), ["feature.ts"]);
        });
    });

    it("returns a warning instead of throwing", () => {
        assert.match(collectChanges(undefined).warning ?? "", /No base ref/);
        repo((root) => {
            assert.match(collectChanges("does-not-exist", "HEAD", root).warning ?? "", /fetch-depth/);
        });
    });
});

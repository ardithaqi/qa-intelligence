import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { branchName, collectChanges, collectPatches } from "./gitContext";

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

describe("collectPatches", () => {
    it("returns each file's diff without git headers, even from a subfolder", () => {
        repo((root, git) => {
            write(root, "src/lib/money.ts", "export const round = (n: number) => Math.round(n);\n");
            fs.mkdirSync(path.join(root, "playwright"));
            write(root, "playwright/x.txt", "x");
            git("add", ".");
            git("commit", "-qm", "base");
            git("checkout", "-qb", "feature");
            write(root, "src/lib/money.ts", "export const round = (n: number) => Math.floor(n);\n");
            git("commit", "-qam", "floor");

            const patches = collectPatches("main", ["src/lib/money.ts"], "HEAD", path.join(root, "playwright"));
            assert.match(patches["src/lib/money.ts"], /-export const round = \(n: number\) => Math\.round\(n\);/);
            assert.match(patches["src/lib/money.ts"], /\+export const round = \(n: number\) => Math\.floor\(n\);/);
            assert.doesNotMatch(patches["src/lib/money.ts"], /diff --git|\+\+\+ /);
        });
    });

    it("returns nothing without a base", () => {
        assert.deepEqual(collectPatches(undefined, ["a.ts"]), {});
    });
});

describe("branchName", () => {
    it("names the branch from a base ref, for any branch name", () => {
        assert.equal(branchName("origin/dev"), "dev");
        assert.equal(branchName("origin/pre-dev"), "pre-dev");
        assert.equal(branchName("refs/remotes/origin/master"), "master");
        assert.equal(branchName("release/v1.3"), "release/v1.3");
    });

    it("gives nothing for a commit SHA or HEAD-relative ref", () => {
        assert.equal(branchName("76138e9e3a87840b59b17680c9e9a33d0be47e4c"), undefined);
        assert.equal(branchName("HEAD~1"), undefined);
        assert.equal(branchName(undefined), undefined);
    });
});

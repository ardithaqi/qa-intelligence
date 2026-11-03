import { execFileSync } from "child_process";
import type { ChangeContext, ChangedFile } from "./types";

function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 20 * 1024 * 1024,
    });
}

/**
 * Files changed between `base` and `head` (merge-base diff, like a PR's
 * "Files changed" tab), each with the latest commit in range that touched it.
 * Two git calls total. Never throws: failures come back as `warning`.
 */
export function collectChanges(base: string | undefined, head = "HEAD", cwd = process.cwd()): ChangeContext {
    if (!base) {
        return { files: [], warning: "No base ref given (--base); likely-source attribution skipped." };
    }

    try {
        const paths = git(["diff", "--name-only", "-z", `${base}...${head}`], cwd)
            .split("\0")
            .filter(Boolean);

        // Newest first; first sighting of a path is its latest touching commit.
        const log = git(["log", "--no-merges", "--name-only", "--format=%x1e%H%x1f%s", `${base}..${head}`], cwd);
        const latest = new Map<string, { commit: string; subject: string }>();

        for (const record of log.split("\x1e")) {
            const [header, ...files] = record.split("\n");
            if (!header) continue;
            const [commit, subject = ""] = header.split("\x1f");
            for (const file of files.map((f) => f.trim()).filter(Boolean)) {
                if (!latest.has(file)) latest.set(file, { commit, subject });
            }
        }

        const files: ChangedFile[] = paths.map((path) => {
            const hit = latest.get(path);
            return hit ? { path, commit: hit.commit, commitSubject: hit.subject } : { path };
        });

        return { files };
    } catch (error) {
        const detail = (error as { stderr?: string }).stderr?.toString().trim().split("\n")[0];
        return {
            files: [],
            warning: `Could not read git changes for ${base}...${head}${detail ? ` (${detail})` : ""}. In CI, check out with fetch-depth: 0.`,
        };
    }
}

export const MAX_PATCH_CHARS = 3000;
export const MAX_TOTAL_PATCH_CHARS = 20000;

/**
 * Unified diff (3 lines of context) per file for `base...head`, each capped at
 * MAX_PATCH_CHARS and the whole set at MAX_TOTAL_PATCH_CHARS so an AI prompt
 * stays small. Files that fail to diff are skipped. Never throws.
 */
export function collectPatches(
    base: string | undefined,
    files: string[],
    head = "HEAD",
    cwd = process.cwd()
): Record<string, string> {
    const patches: Record<string, string> = {};
    if (!base) return patches;

    let total = 0;
    for (const file of files) {
        if (total >= MAX_TOTAL_PATCH_CHARS) break;
        try {
            // Paths from `git diff --name-only` are repo-root relative; ":(top)" keeps them so from a subfolder.
            let patch = git(["diff", "--no-color", "-U3", `${base}...${head}`, "--", `:(top)${file}`], cwd)
                .split("\n")
                .filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l))
                .join("\n")
                .trim();
            if (!patch) continue;
            const room = Math.min(MAX_PATCH_CHARS, MAX_TOTAL_PATCH_CHARS - total);
            if (patch.length > room) patch = `${patch.slice(0, room)}\n… (diff truncated)`;
            patches[file] = patch;
            total += patch.length;
        } catch { }
    }
    return patches;
}

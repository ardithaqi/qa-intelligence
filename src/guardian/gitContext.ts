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

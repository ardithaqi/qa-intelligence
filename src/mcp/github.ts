import { execFileSync } from "child_process";
import { unzipSync } from "fflate";
import { Octokit } from "@octokit/rest";

/** What the MCP tools need from GitHub. Faked in tests. */
export interface GitHubClient {
    /** Open PR whose head is `branch`, or null. */
    findOpenPr(branch: string): Promise<{ number: number; headSha: string } | null>;
    /** Head commit of a PR, or null if the PR doesn't exist. */
    prHeadSha(pr: number): Promise<string | null>;
    /** Zip of the newest artifact whose name starts with `prefix`, from runs of `headSha`. */
    artifactForCommit(headSha: string, prefix: string): Promise<Uint8Array | null>;
    /**
     * Test results from the newest finished run on `branch` (any trigger, not cancelled) that has
     * any: every matching upload of that run (one per brand in a multi-brand setup), or null.
     */
    baselineForBranch(branch: string): Promise<{ runId: number; zips: Uint8Array[] } | null>;
    /** Status of the workflow runs for a commit ("queued", "in_progress", "completed", ...). */
    runStatusesForCommit(headSha: string): Promise<string[]>;
}

function git(args: string[], cwd: string): string {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * Which uploads of one run hold its test results, whatever they're called: a dedicated
 * `playwright-artifacts-baseline` first, then full results folders (`...-raw-...`), then any
 * other `playwright-artifacts-*` (HTML reports excluded). Several matches = several brands.
 */
export function pickBaselineArtifacts(names: string[]): string[] {
    if (names.includes("playwright-artifacts-baseline")) return ["playwright-artifacts-baseline"];
    const results = names.filter((n) => /^playwright-artifacts-/.test(n) && !/report/.test(n));
    const raw = results.filter((n) => /-raw-/.test(n));
    return raw.length ? raw : results;
}

/** owner/repo from the `origin` remote (https or ssh GitHub URLs). */
export function repoFromGit(cwd: string): { owner: string; repo: string } | null {
    try {
        const url = git(["remote", "get-url", "origin"], cwd);
        const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
        return m ? { owner: m[1], repo: m[2] } : null;
    } catch {
        return null;
    }
}

export function currentBranch(cwd: string): string | null {
    try {
        const b = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
        return b && b !== "HEAD" ? b : null;
    } catch {
        return null;
    }
}

export function headSha(cwd: string): string | null {
    try {
        return git(["rev-parse", "HEAD"], cwd);
    } catch {
        return null;
    }
}

/** The repo's default branch as a ref (origin/main, origin/dev, ...), detected from git. */
export function defaultBaseRef(cwd: string): string {
    try {
        return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
    } catch {
        // origin/HEAD isn't always set (e.g. a fetch without clone): the first common name that exists.
        for (const name of ["main", "master", "dev"]) {
            try {
                git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`], cwd);
                return `origin/${name}`;
            } catch {
                /* not this one */
            }
        }
        return "origin/main";
    }
}

/** GITHUB_TOKEN / GH_TOKEN, else the GitHub CLI's token if it's signed in. */
/**
 * GITHUB_TOKEN / GH_TOKEN, else the GitHub CLI's token. With several `gh` accounts signed in
 * (work + personal), the one named like the repo owner is preferred over the active one.
 */
export function githubToken(env: NodeJS.ProcessEnv = process.env, owner?: string): string | null {
    const fromEnv = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    const gh = (args: string[]) => {
        try {
            return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
        } catch {
            return null;
        }
    };
    return (owner ? gh(["auth", "token", "-u", owner]) : null) ?? gh(["auth", "token"]);
}

/** First file in a zip whose path ends with `name`, as text. */
export function readFromZip(zip: Uint8Array, name: string): string | null {
    const files = unzipSync(zip);
    const key = Object.keys(files).find((k) => k === name || k.endsWith(`/${name}`));
    return key ? new TextDecoder().decode(files[key]) : null;
}

/** All files of a zip, for extracting a downloaded artifact. */
export function unzipAll(zip: Uint8Array): Record<string, Uint8Array> {
    return unzipSync(zip);
}

export function createGitHubClient(owner: string, repo: string, token: string): GitHubClient {
    // Silent: stdout belongs to the MCP protocol, and errors are explained to the agent instead.
    const octokit = new Octokit({ auth: token, log: { debug() {}, info() {}, warn() {}, error() {} } });

    async function download(artifactId: number): Promise<Uint8Array> {
        const res = await octokit.actions.downloadArtifact({ owner, repo, artifact_id: artifactId, archive_format: "zip" });
        return new Uint8Array(res.data as ArrayBuffer);
    }

    async function newestArtifact(runIds: number[], match: (name: string) => boolean): Promise<Uint8Array | null> {
        for (const run_id of runIds) {
            const { data } = await octokit.actions.listWorkflowRunArtifacts({ owner, repo, run_id, per_page: 100 });
            const hit = data.artifacts.find((a) => !a.expired && match(a.name));
            if (hit) return download(hit.id);
        }
        return null;
    }

    return {
        async findOpenPr(branch) {
            const { data } = await octokit.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open", per_page: 1 });
            return data[0] ? { number: data[0].number, headSha: data[0].head.sha } : null;
        },
        async prHeadSha(pr) {
            try {
                const { data } = await octokit.pulls.get({ owner, repo, pull_number: pr });
                return data.head.sha;
            } catch {
                return null;
            }
        },
        async artifactForCommit(sha, prefix) {
            const { data } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, head_sha: sha, per_page: 10 });
            return newestArtifact(data.workflow_runs.map((r) => r.id), (n) => n.startsWith(prefix));
        },
        async runStatusesForCommit(sha) {
            const { data } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, head_sha: sha, per_page: 10 });
            return data.workflow_runs.map((r) => r.status ?? "unknown");
        },
        async baselineForBranch(branch) {
            const { data } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, branch, status: "completed", per_page: 20 });
            for (const run of data.workflow_runs) {
                if (run.conclusion !== "success" && run.conclusion !== "failure") continue;
                const { data: list } = await octokit.actions.listWorkflowRunArtifacts({ owner, repo, run_id: run.id, per_page: 100 });
                const names = pickBaselineArtifacts(list.artifacts.filter((a) => !a.expired).map((a) => a.name));
                if (!names.length) continue;
                const ids = list.artifacts.filter((a) => names.includes(a.name)).map((a) => a.id);
                return { runId: run.id, zips: await Promise.all(ids.map(download)) };
            }
            return null;
        },
    };
}

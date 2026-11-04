import { execFileSync, spawnSync } from "child_process";
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
    baselineForBranch(branch: string): Promise<{ runId: number; createdAt?: string; zips: Uint8Array[] } | null>;
    /**
     * What the guardian's workflow did for a commit: no run, still running, skipped by the
     * workflow's own conditions, or finished. Other workflows on the commit are ignored once the
     * repo has a guardian report anywhere (that's how the guardian's workflow is recognized).
     */
    ciStateForCommit(headSha: string): Promise<"none" | "running" | "skipped" | "done">;
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

/** The real host behind an SSH host alias in ~/.ssh/config (`ssh -G` reads the config, connects nowhere). */
export function sshHostname(alias: string): string | null {
    try {
        const out = execFileSync("ssh", ["-G", alias], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 });
        return out.match(/^hostname (\S+)$/m)?.[1] ?? null;
    } catch {
        return null;
    }
}

/**
 * owner/repo from a GitHub remote URL: https (with or without user@, .git, trailing slash),
 * ssh://, and git@host:owner/repo. An SSH host alias (git@github-work:org/repo, common with
 * several GitHub accounts) counts when it resolves to github.com.
 */
export function parseGitHubRemote(
    url: string,
    resolveHost: (alias: string) => string | null = sshHostname
): { owner: string; repo: string } | null {
    const m = url.trim().match(/^(?:(https?|ssh|git):\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (!m) return null;
    const [, scheme, host, owner, repo] = m;
    const isGitHub = (h: string | null) => h === "github.com" || h === "www.github.com";
    if (!isGitHub(host)) {
        // Only SSH remotes can use ~/.ssh/config aliases.
        if (scheme === "https" || scheme === "http" || !isGitHub(resolveHost(host))) return null;
    }
    return { owner, repo };
}

/** owner/repo from the `origin` remote. */
export function repoFromGit(cwd: string): { owner: string; repo: string } | null {
    try {
        return parseGitHubRemote(git(["remote", "get-url", "origin"], cwd));
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

/**
 * Every token that might reach the repo, most likely first: GITHUB_TOKEN / GH_TOKEN, the `gh`
 * account named like the owner, the active `gh` account, then the other signed-in `gh` accounts
 * (work + personal setups: an org repo is named after the org, not after any account).
 */
export function githubTokens(env: NodeJS.ProcessEnv = process.env, owner?: string): string[] {
    const tokens: string[] = [];
    const add = (t: string | null | undefined) => {
        const v = t?.trim();
        if (v && !tokens.includes(v)) tokens.push(v);
    };
    add(env.GITHUB_TOKEN);
    add(env.GH_TOKEN);
    const gh = (args: string[]) => {
        try {
            return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim() || null;
        } catch {
            return null;
        }
    };
    if (owner) add(gh(["auth", "token", "-u", owner]));
    add(gh(["auth", "token"]));
    const status = spawnSync("gh", ["auth", "status"], { encoding: "utf8", timeout: 5000 });
    const accounts = [...`${status.stdout ?? ""}${status.stderr ?? ""}`.matchAll(/Logged in to github\.com account (\S+)/g)].map((m) => m[1]);
    for (const account of accounts) add(gh(["auth", "token", "-u", account]));
    return tokens;
}

/** The first of githubTokens(), for callers that need just one. */
export function githubToken(env: NodeJS.ProcessEnv = process.env, owner?: string): string | null {
    return githubTokens(env, owner)[0] ?? null;
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

type Artifact = {
    id: number;
    name: string;
    expired: boolean;
    created_at?: string | null;
    workflow_run?: { id?: number; head_branch?: string | null; head_sha?: string } | null;
};

/** How many pages of the repo's artifact list (100 each, newest first) to search. */
const ARTIFACT_PAGES = 5;

export function createGitHubClient(owner: string, repo: string, tokens: string | string[]): GitHubClient {
    const candidates = Array.isArray(tokens) ? tokens : [tokens];
    // Silent: stdout belongs to the MCP protocol, and errors are explained to the agent instead.
    const silent = { debug() {}, info() {}, warn() {}, error() {} };

    // The first token that can see the repo (several accounts: a personal token can't see a
    // private org repo). Picked once, on the first request.
    let chosen: Promise<Octokit> | undefined;
    const api = () =>
        (chosen ??= (async () => {
            let last: unknown;
            for (const auth of candidates) {
                const octokit = new Octokit({ auth, log: silent });
                try {
                    await octokit.repos.get({ owner, repo });
                    return octokit;
                } catch (err) {
                    last = err;
                    const status = (err as { status?: number }).status;
                    if (status !== 401 && status !== 403 && status !== 404) throw err;
                }
            }
            throw last ?? Object.assign(new Error("no token"), { status: 401 });
        })());

    async function download(artifactId: number): Promise<Uint8Array> {
        const res = await (await api()).actions.downloadArtifact({ owner, repo, artifact_id: artifactId, archive_format: "zip" });
        return new Uint8Array(res.data as ArrayBuffer);
    }

    /**
     * The repo's artifacts, newest first, across all workflows. One list call covers what used to
     * take one call per run, and a busy repo (deploys, nightly shards) can't push the test run out
     * of a small window of recent runs.
     */
    // Pages are kept for a minute, so one question (report + workflow + baseline lookups) lists
    // them once, while a later question still sees new CI runs.
    const pages = new Map<number, { at: number; items: Artifact[] }>();
    async function page(n: number): Promise<Artifact[]> {
        const hit = pages.get(n);
        if (hit && Date.now() - hit.at < 60_000) return hit.items;
        const { data } = await (await api()).actions.listArtifactsForRepo({ owner, repo, per_page: 100, page: n });
        const items = data.artifacts as Artifact[];
        pages.set(n, { at: Date.now(), items });
        return items;
    }
    async function* artifacts(): AsyncGenerator<Artifact> {
        const first = await page(1);
        // GitHub answers deep pages slowly one by one (seconds each) but fast together.
        const rest = first.length < 100 ? [] : await Promise.all(Array.from({ length: ARTIFACT_PAGES - 1 }, (_, i) => page(i + 2)));
        for (const items of [first, ...rest]) {
            for (const a of items) if (!a.expired) yield a;
            if (items.length < 100) return;
        }
    }

    /** Workflow that uploads guardian reports, recognized from the newest report in the repo. */
    let guardianWorkflow: Promise<number | null> | undefined;
    const findGuardianWorkflow = () =>
        (guardianWorkflow ??= (async () => {
            for await (const a of artifacts()) {
                if (a.name.startsWith("release-guardian-") && a.workflow_run?.id) {
                    const { data } = await (await api()).actions.getWorkflowRun({ owner, repo, run_id: a.workflow_run.id });
                    return data.workflow_id;
                }
            }
            return null;
        })());

    return {
        async findOpenPr(branch) {
            const { data } = await (await api()).pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open", per_page: 1 });
            return data[0] ? { number: data[0].number, headSha: data[0].head.sha } : null;
        },
        async prHeadSha(pr) {
            const octokit = await api();
            try {
                const { data } = await octokit.pulls.get({ owner, repo, pull_number: pr });
                return data.head.sha;
            } catch {
                return null;
            }
        },
        async artifactForCommit(sha, prefix) {
            for await (const a of artifacts()) {
                if (a.workflow_run?.head_sha === sha && a.name.startsWith(prefix)) return download(a.id);
            }
            return null;
        },
        async ciStateForCommit(sha) {
            const octokit = await api();
            const { data } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, head_sha: sha, per_page: 100 });
            const workflow = await findGuardianWorkflow();
            const runs = workflow == null ? data.workflow_runs : data.workflow_runs.filter((r) => r.workflow_id === workflow);
            if (runs.length === 0) return "none";
            if (runs.some((r) => r.status !== "completed")) return "running";
            if (runs.every((r) => r.conclusion === "skipped")) return "skipped";
            return "done";
        },
        async baselineForBranch(branch) {
            const octokit = await api();
            // Group the branch's uploads by run, newest run first.
            const byRun = new Map<number, Artifact[]>();
            for await (const a of artifacts()) {
                const id = a.workflow_run?.id;
                if (id && a.workflow_run?.head_branch === branch) byRun.set(id, [...(byRun.get(id) ?? []), a]);
            }
            for (const [runId, list] of byRun) {
                const names = pickBaselineArtifacts(list.map((a) => a.name));
                if (!names.length) continue;
                const { data: run } = await octokit.actions.getWorkflowRun({ owner, repo, run_id: runId });
                if (run.conclusion !== "success" && run.conclusion !== "failure") continue;
                const ids = list.filter((a) => names.includes(a.name)).map((a) => a.id);
                return { runId, createdAt: run.created_at, zips: await Promise.all(ids.map(download)) };
            }
            return null;
        },
    };
}

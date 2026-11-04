import fs from "fs";
import os from "os";
import path from "path";
import { analyzeRelease } from "../guardian/analyzeRelease";
import { loadGuardianConfig } from "../guardian/config";
import { shortReason } from "../guardian/format";
import { branchName, collectChangesWithWorktree } from "../guardian/gitContext";
import { readRunSummary } from "../guardian/runSummary";
import type { ClassifiedFailure, FailureGroup, ReleaseReport } from "../guardian/types";
import { computeDiff } from "../lib/computeDiff";
import { stripAnsi } from "../lib/failureSignals";
import { computeFlakyWatchlist } from "../lib/flakyWatchlist";
import { loadHistory } from "../lib/history";
import type { DiffResult, FlakyWatchlistEntry } from "../lib/types";
import { currentBranch, defaultBaseRef, headSha, readFromZip, unzipAll, type GitHubClient } from "./github";

/** CI artifact uploaded by the scaffolded workflow (release-guardian-<run id>). */
export const REPORT_ARTIFACT_PREFIX = "release-guardian-";
/** Baseline artifact uploaded on pushes to the default branch. */

export interface LoadedReport {
    /** "PR #12" or "local run". */
    source: string;
    report: ReleaseReport;
    diff: DiffResult;
}

export interface ToolDeps {
    /** Repo root (where the MCP server runs). */
    cwd: string;
    /** null when no GitHub token or no GitHub remote. */
    github: GitHubClient | null;
    /** Why `github` is null, shown to the user. */
    githubProblem?: string;
}

/** State kept for one MCP session: the last report loaded, for follow-up questions. */
export class GuardianSession {
    last?: LoadedReport;
    constructor(readonly deps: ToolDeps) {}
}

const NO_CI = "No CI result for this PR yet. Run analyze_local for a local verdict.";

// --- paths ---------------------------------------------------------------------

/** Folder holding the Playwright project: cwd itself, or `playwright/` under it (init's layout). */
export function playwrightDir(cwd: string): string {
    const scaffolded = path.join(cwd, "playwright");
    if (!fs.existsSync(path.join(cwd, "playwright.config.ts")) && fs.existsSync(scaffolded)) return scaffolded;
    return cwd;
}

/** Repo-relative path an agent can open: tests/x.spec.ts may live under playwright/. */
export function repoPath(cwd: string, file: string): string {
    if (fs.existsSync(path.join(cwd, file))) return file;
    const scaffolded = path.join("playwright", file);
    return fs.existsSync(path.join(cwd, scaffolded)) ? scaffolded : file;
}

// --- text ------------------------------------------------------------------------

function categoryLabel(c: string): string {
    return { regression: "Regression", test_issue: "Broken test", unknown: "Unclear", infrastructure: "Infrastructure", flaky: "Flaky" }[c] ?? c;
}

function problemLine(cwd: string, g: FailureGroup): string {
    const first = g.failures[0].failure;
    const where = g.failures.length === 1 ? `${repoPath(cwd, first.file)}:${first.line}` : `${g.failures.length} tests`;
    const cause = g.rootCauseKind === "changed_file" ? ` · likely cause ${g.rootCause}` : "";
    return `${g.id} ${categoryLabel(g.category)} · ${where} · ${shortReason(first)}${cause}`;
}

/** Compact verdict: the same content as the PR comment, as plain text for an agent. */
/** The branch the change merges into, as the report recorded it, or a neutral word. */
const baseWord = (r: ReleaseReport) => r.baseBranch ?? "the base branch";

export function formatVerdictText(cwd: string, loaded: LoadedReport): string {
    const { report: r } = loaded;
    const lines = [
        `${r.decision}${r.decision === "SAFE TO MERGE" ? "" : ` · ${r.risk.level} risk (${r.risk.score}/100)`}  [${loaded.source}]`,
        r.decisionReason,
    ];
    if (r.aiOverview) lines.push(`AI summary: ${r.aiOverview}`);
    if (r.groups.length) {
        lines.push("", "Problems:", ...r.groups.map((g) => problemLine(cwd, g)));
        lines.push("", "Call explain_problem with an id (e.g. G1) for the cause, fix and error.");
    }
    const extra = [
        r.preExistingCount ? `${r.preExistingCount} still failing from ${baseWord(r)} (not caused by this change)` : "",
        r.preExistingFlakyCount ? `${r.preExistingFlakyCount} flaky on ${baseWord(r)} too (passed on retry, not caused by this change)` : "",
        r.fixedCount ? `${r.fixedCount} fixed` : "",
    ].filter(Boolean);
    if (extra.length) lines.push("", extra.join(" · "));
    return lines.join("\n");
}

function errorSnippet(message: string | undefined): string {
    const lines = stripAnsi(message ?? "").split("\n").filter((l) => l.trim());
    const callLog = lines.findIndex((l) => /^\s*Call log:/.test(l));
    return (callLog >= 0 ? lines.slice(0, callLog) : lines).slice(0, 8).join("\n");
}

export function formatProblemText(cwd: string, g: FailureGroup): string {
    const lines = [`${g.id} ${categoryLabel(g.category)} (${g.failures.length} test${g.failures.length === 1 ? "" : "s"})`, "", "Tests:"];
    for (const item of g.failures) {
        const f = item.failure;
        lines.push(`- ${repoPath(cwd, f.file)}:${f.line}${f.title ? ` "${f.title}"` : ""}${f.project ? ` [${f.project}]` : ""}`);
    }
    if (g.rootCauseKind === "changed_file") {
        const attr = g.failures.find((f) => f.attribution?.path === g.rootCause)?.attribution;
        const commit = g.commit ? `, commit ${g.commit.slice(0, 7)}${attr?.commitSubject ? ` "${attr.commitSubject}"` : ""}` : "";
        lines.push("", `Likely cause: ${g.rootCause} (${g.confidence}%${commit})`);
    }
    const ai = g.failures.find((f) => f.aiCause)?.aiCause;
    const note = g.failures.find((f) => f.failure.aiNote)?.failure.aiNote;
    if (ai) {
        lines.push(`AI: ${ai.summary}`);
        if (ai.fix) lines.push(`Fix: ${ai.fix}`);
    } else if (note) {
        lines.push(`AI: ${note}`);
    }
    const c = g.failures[0].classification;
    lines.push("", `Why ${categoryLabel(g.category).toLowerCase()} (${c.confidence}%): ${c.reasons.join(" ")}`);
    const error = errorSnippet(g.failures[0].failure.errorMessage);
    if (error) lines.push("", "Error:", error);
    return lines.join("\n");
}

// --- loading reports ----------------------------------------------------------------

function parseSaved(json: string): { report: ReleaseReport; diff: DiffResult } {
    const saved = JSON.parse(json);
    if (!saved?.report?.decision || !saved?.diff) throw new Error("not a release-report.json");
    return saved;
}

export async function getPrVerdict(session: GuardianSession, pr?: number): Promise<string> {
    const { github, githubProblem } = session.deps;
    if (!github) return `Can't reach GitHub: ${githubProblem ?? "no client"}. For a local verdict, use analyze_local.`;
    try {
        return await prVerdict(session, github, pr);
    } catch (err) {
        const status = (err as { status?: number }).status;
        const why =
            status === 401 ? "the GitHub token is invalid or expired"
            : status === 403 || status === 404 ? "the GitHub token can't see this repo (private repo and a token for another account? With several gh accounts: `gh auth switch`, or set GITHUB_TOKEN)"
            : `GitHub request failed (${(err as Error).message})`;
        return `Can't read the CI result: ${why}. For a local verdict, use analyze_local.`;
    }
}

async function prVerdict(session: GuardianSession, github: GitHubClient, pr?: number): Promise<string> {
    const { cwd } = session.deps;

    let number = pr;
    let sha: string | null = null;
    if (number == null) {
        const branch = currentBranch(cwd);
        if (!branch) return "Not on a branch (detached HEAD). Pass a PR number, or use analyze_local.";
        const open = await github.findOpenPr(branch);
        if (!open) return `No open PR for branch "${branch}". Open one, pass a PR number, or use analyze_local.`;
        number = open.number;
        sha = open.headSha;
    } else {
        sha = await github.prHeadSha(number);
        if (!sha) return `PR #${number} not found.`;
    }

    const zip = await github.artifactForCommit(sha, REPORT_ARTIFACT_PREFIX);
    const json = zip ? readFromZip(zip, "release-report.json") : null;
    if (!json) {
        const statuses = await github.runStatusesForCommit(sha);
        if (statuses.length === 0) return NO_CI;
        if (statuses.some((s) => s !== "completed")) {
            return `CI is still running for PR #${number} (commit ${sha.slice(0, 7)}). Try again when it finishes, or run analyze_local for a local verdict.`;
        }
        return `CI ran for PR #${number} (commit ${sha.slice(0, 7)}) but produced no guardian report. Usually the base branch has no test results yet: the guardian runs once the workflow has run there. Run analyze_local for a local verdict.`;
    }

    session.last = { source: `PR #${number} @ ${sha.slice(0, 7)}`, ...parseSaved(json) };
    let text = formatVerdictText(cwd, session.last);
    const local = headSha(cwd);
    if (pr == null && local && local !== sha) {
        text += `\n\nNote: this result is for ${sha.slice(0, 7)}; your local HEAD is ${local.slice(0, 7)} (not pushed yet, or CI hasn't finished). analyze_local checks your current code.`;
    }
    return text;
}

/**
 * Local Playwright runs pile up as artifacts/run-<timestamp>/ folders. Only the newest one
 * reflects the current code; reading them all would keep reporting failures already fixed.
 */
export function latestRun(dir: string): string {
    const runs = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith("run-"))
        .map((e) => e.name)
        .sort();
    return runs.length ? path.join(dir, runs[runs.length - 1]) : dir;
}

/** Baseline failures from the base branch: local baseline-artifacts, else its latest CI results. */
async function baselineDir(session: GuardianSession, pwDir: string, base: string): Promise<{ dir?: string; note?: string }> {
    const local = path.join(pwDir, "baseline-artifacts");
    if (fs.existsSync(local)) return { dir: latestRun(local) };

    const branch = branchName(base) ?? base;
    const github = session.deps.github;
    if (!github) return { note: `No baseline from ${branch}: failures already failing there show up as new.` };
    try {
        const found = await github.baselineForBranch(branch);
        if (!found) return { note: `No CI test results found on ${branch}: failures already failing there show up as new.` };
        // Extracted outside the repo, so analyze_local never writes into the project.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-guardian-baseline-"));
        found.zips.forEach((zip, i) => {
            const into = path.join(dir, String(i));
            for (const [name, data] of Object.entries(unzipAll(zip))) {
                if (name.endsWith("/")) continue;
                const target = path.join(into, name);
                if (!target.startsWith(into + path.sep)) continue; // zip-slip guard
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, data);
            }
        });
        return { dir };
    } catch {
        return { note: `Couldn't download the CI test results from ${branch}: failures already failing there show up as new.` };
    }
}

/**
 * Tests that ran on the base branch, from its run-summary.json files: next to the run folder
 * (local), or one per downloaded upload (summed, for one upload per brand).
 */
function baselineTotal(baseline: string): number | undefined {
    const direct = readRunSummary(baseline) ?? readRunSummary(path.dirname(baseline));
    if (direct) return direct.total;
    const parts = fs.readdirSync(baseline, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => readRunSummary(path.join(baseline, e.name))?.total)
        .filter((n): n is number => n != null);
    return parts.length ? parts.reduce((a, b) => a + b, 0) : undefined;
}

/** Start time encoded in a run folder name (run-2026-11-04T09-37-29-829Z), or undefined. */
function runStartedAt(runDir: string): number | undefined {
    const m = path.basename(runDir).match(/^run-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : undefined;
}

/**
 * The artifacts folder of the most recent local run. The hooks write artifacts/ relative to
 * where Playwright was started: playwright/artifacts from `cd playwright`, but artifacts/ at the
 * repo root when the VS Code extension or `npx playwright test -c playwright` runs from the root.
 */
function localArtifacts(cwd: string, pwDir: string): string | undefined {
    const candidates = [...new Set([path.join(pwDir, "artifacts"), path.join(cwd, "artifacts")])].filter((d) => fs.existsSync(d));
    const started = (d: string) => runStartedAt(latestRun(d)) ?? fs.statSync(d).mtimeMs;
    return candidates.sort((a, b) => started(b) - started(a))[0];
}

/** Why the latest local run can't be judged as a whole, or undefined when it can. */
function incompleteRun(current: string, run: string): string | undefined {
    const summary = readRunSummary(current);
    const summaryFile = path.join(current, "run-summary.json");
    const started = runStartedAt(run);
    const stale = summary && started != null && fs.statSync(summaryFile).mtimeMs < started;
    // No summary at all means the reporter isn't configured: nothing to tell, so judge the run.
    if (summary?.status === "interrupted" || stale) {
        return "The latest test run didn't finish (stopped or still running), so its results are incomplete. Run the tests again (npx playwright test), then call analyze_local.";
    }
    return undefined;
}

export async function analyzeLocal(session: GuardianSession, base?: string): Promise<string> {
    const { cwd } = session.deps;
    const pwDir = playwrightDir(cwd);
    const current = localArtifacts(cwd, pwDir);
    if (!current) {
        return `No local test results in ${path.relative(cwd, path.join(pwDir, "artifacts")) || "artifacts"}/. Run your Playwright tests first (npx playwright test).`;
    }
    const run = latestRun(current);
    const incomplete = incompleteRun(current, run);
    if (incomplete) return incomplete;

    const baseRef = base ?? defaultBaseRef(cwd);
    const { dir: baseline, note } = await baselineDir(session, pwDir, baseRef);
    const diff = computeDiff(baseline ?? path.join(pwDir, ".no-baseline"), run);

    // Only part of the suite ran (one spec file, --grep): tests that didn't run aren't "fixed",
    // and the verdict covers only what ran.
    const ran = readRunSummary(current)?.total;
    // run-summary.json sits in the artifacts folder, one level above the run folder.
    const onBase = baseline ? baselineTotal(baseline) : undefined;
    const partial = ran != null && onBase != null && ran < onBase;
    if (partial) diff.fixedFailures = [];

    const historyFile = path.join(pwDir, ".cache", "failure-history.json");
    const report = analyzeRelease(diff, {
        changes: collectChangesWithWorktree(baseRef, cwd),
        runSummary: readRunSummary(current),
        history: fs.existsSync(historyFile) ? loadHistory(historyFile) : undefined,
        config: loadGuardianConfig(path.join(pwDir, "release-guardian.config.json")).config,
        baseBranch: branchName(baseRef),
    });

    session.last = { source: "local run", report, diff };
    const warning = partial
        ? `Partial run: only ${ran} of ${onBase} tests ran (${baseWord(report)} ran ${onBase}). This verdict covers only those tests; run the full suite (npx playwright test) before merging.\n\n`
        : "";
    return warning + formatVerdictText(cwd, session.last) + (note ? `\n\nNote: ${note}` : "");
}

function findLoaded(session: GuardianSession): LoadedReport | undefined {
    if (session.last) return session.last;
    // A report written by `ai-release-guardian analyze` in this checkout.
    for (const dir of [session.deps.cwd, playwrightDir(session.deps.cwd)]) {
        const file = path.join(dir, "release-report.json");
        if (fs.existsSync(file)) {
            try {
                return (session.last = { source: path.relative(session.deps.cwd, file), ...parseSaved(fs.readFileSync(file, "utf8")) });
            } catch { }
        }
    }
    return undefined;
}

const NO_REPORT = "No report loaded yet. Call get_pr_verdict (CI result) or analyze_local (your local run) first.";

export function explainProblem(session: GuardianSession, problem: string): string {
    const loaded = findLoaded(session);
    if (!loaded) return NO_REPORT;
    const want = problem.trim();
    const group = loaded.report.groups.find(
        (g) =>
            g.id.toLowerCase() === want.toLowerCase() ||
            g.failures.some((f) => want.endsWith(f.failure.file) || f.failure.file.endsWith(want.replace(/^playwright\//, "").split(":")[0]))
    );
    if (!group) {
        const ids = loaded.report.groups.map((g) => g.id).join(", ") || "none";
        return `No problem "${want}" in the ${loaded.source} report. Problems: ${ids}.`;
    }
    return formatProblemText(session.deps.cwd, group);
}

function localHistory(cwd: string) {
    const file = path.join(playwrightDir(cwd), ".cache", "failure-history.json");
    return fs.existsSync(file) ? loadHistory(file) : undefined;
}

export function flakyTests(session: GuardianSession, limit = 10): string {
    const history = localHistory(session.deps.cwd);
    let entries: FlakyWatchlistEntry[] = history ? computeFlakyWatchlist(history) : [];
    let source = "local history";
    if (!entries.length) {
        const loaded = findLoaded(session);
        entries = loaded?.diff.flakyWatchlist ?? [];
        source = loaded ? `CI history (${loaded.source})` : source;
    }
    const flakyNow = (findLoaded(session)?.report.failures ?? []).filter((f) => f.classification.category === "flaky");

    const lines: string[] = [];
    if (entries.length) {
        lines.push(`Most unstable tests (${source}):`);
        for (const e of entries.slice(0, limit)) {
            lines.push(`- ${repoPath(session.deps.cwd, e.testFile)}: failed in ${e.failCount} of the last ${e.totalRuns} runs (${Math.round(e.failRate * 100)}%)`);
        }
    }
    if (flakyNow.length) {
        if (lines.length) lines.push("");
        lines.push("Flaky in the latest run (failed, then passed on retry):");
        for (const f of flakyNow.slice(0, limit)) lines.push(`- ${repoPath(session.deps.cwd, f.failure.file)}:${f.failure.line}`);
    }
    return lines.length
        ? lines.join("\n")
        : "No flaky tests found. History builds up as CI runs; call get_pr_verdict to load CI's data.";
}

export function failureHistory(session: GuardianSession, test: string): string {
    const want = test.replace(/^playwright\//, "").split(":")[0];
    const matches = (file: string) => file === want || file.endsWith(want) || want.endsWith(file);
    const loaded = findLoaded(session);
    const lines: string[] = [];

    const inReport = (loaded?.report.failures ?? []).filter((f: ClassifiedFailure) => matches(f.failure.file));
    for (const f of inReport) {
        const seen = f.failure.occurrence_count
            ? `failed ${f.failure.occurrence_count} time(s)${f.failure.first_seen ? ` since ${f.failure.first_seen.slice(0, 10)}` : ""}`
            : "no recurrence data";
        const base = baseWord(loaded!.report);
        const when = f.lifecycle === "existing" ? (f.classification.category === "flaky" ? `also flaky on ${base}` : `also failing on ${base}`) : "new in this change";
        lines.push(`${repoPath(session.deps.cwd, f.failure.file)}:${f.failure.line}: ${categoryLabel(f.classification.category)}, ${when}, ${seen} [${loaded!.source}]`);
    }

    const history = localHistory(session.deps.cwd);
    const watch = [...(history ? computeFlakyWatchlist(history) : []), ...(loaded?.diff.flakyWatchlist ?? [])].find((e) => matches(e.testFile));
    if (watch) lines.push(`Intermittent: failed in ${watch.failCount} of the last ${watch.totalRuns} CI runs.`);

    if (!lines.length) {
        return loaded
            ? `${want} isn't failing in the ${loaded.source} report and has no recorded history.`
            : `No data for ${want}. ${NO_REPORT}`;
    }
    return lines.join("\n");
}

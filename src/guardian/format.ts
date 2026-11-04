import { INFRASTRUCTURE_PATTERN, stripAnsi } from "../lib/failureSignals";
import type { DiffResult, Failure } from "../lib/types";
import type { FailureCategory, FailureGroup, ReleaseReport } from "./types";

export const GUARDIAN_COMMENT_HEADER = "## AI Release Guardian";

/** Problems listed one line each; the rest go behind "and N more". */
export const MAX_PROBLEM_LINES = 10;

/** The AI overview is shown only from this many problems; a single problem's own AI line covers it. */
export const MIN_PROBLEMS_FOR_OVERVIEW = 2;

const CATEGORY: Record<FailureCategory, { label: string }> = {
    regression: { label: "Regression" },
    test_issue: { label: "Broken test" },
    unknown: { label: "Unclear" },
    infrastructure: { label: "Infrastructure" },
    flaky: { label: "Flaky" },
};

export interface CommentOptions {
    /** Commit sha shown in the header; defaults to $GITHUB_SHA. Empty string hides it. */
    commit?: string;
    /** Makes file paths clickable: https://github.com/<repo>/blob/<sha>/<path>#L<line>. */
    links?: { server: string; repo: string; sha: string; testPathPrefix?: string };
    /** Link to the CI run (artifacts, traces, full logs). */
    runUrl?: string;
}

// --- escaping -----------------------------------------------------------------

/** For raw HTML contexts (<summary>, <code>). Also defuses @mentions. */
function html(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/@(\w)/g, "@​$1");
}

/** For markdown text. */
function md(text: string): string {
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@(\w)/g, "@​$1");
}

function codeMd(text: string): string {
    return `\`${text.replace(/`/g, "'").replace(/\n/g, " ")}\``;
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const shortSha = (sha: string) => sha.slice(0, 7);
const basename = (file: string) => file.split("/").pop() ?? file;

// --- "why" in a few words ------------------------------------------------------

/** One short human sentence for why a test failed, derived from its error output. */
export function shortReason(failure: Failure): string {
    if (failure.is_flaky_suspected) return "failed, then passed on retry";

    const message = stripAnsi(failure.errorMessage ?? "");
    if (!message.trim()) return failure.failure_type.replace(/_/g, " ");

    const mismatch = message.match(/Expected(?: string| pattern| value)?:\s*(.+)\n\s*Received(?: string| value)?:\s*(.+)/);
    if (mismatch) {
        const expected = mismatch[1].trim();
        const received = mismatch[2].trim();
        if (/element\(s\) not found/.test(received)) return "element not found";
        return `expected ${clip(expected, 40)}, got ${clip(received, 40)}`;
    }

    const net = message.match(/net::(ERR_[A-Z_]+)|\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/);
    if (net && INFRASTRUCTURE_PATTERN.test(message)) return `can't reach server (${net[1] ?? net[2]})`;

    const strict = message.match(/strict mode violation.*resolved to (\d+) elements/);
    if (strict) return `locator matches ${strict[1]} elements`;

    const testTimeout = message.match(/Test timeout of (\d+)ms exceeded/);
    if (testTimeout) return `timed out after ${Number(testTimeout[1]) / 1000}s`;

    const first = message.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    return clip(first.replace(/^Error:\s*/, "").replace(/^[\w.]+:\s*(?:Error:\s*)?/, ""), 80);
}

// --- links ---------------------------------------------------------------------

function blobUrl(options: CommentOptions, repoPath: string, line?: number): string | undefined {
    const l = options.links;
    if (!l) return undefined;
    return `${l.server}/${l.repo}/blob/${l.sha}/${repoPath}${line ? `#L${line}` : ""}`;
}

function testLink(options: CommentOptions, f: Failure, text = `${f.file}:${f.line}`): string {
    const url = blobUrl(options, `${options.links?.testPathPrefix ?? ""}${f.file}`, f.line);
    return url ? `[${codeMd(text)}](${url})` : codeMd(text);
}

function fileLink(options: CommentOptions, repoPath: string): string {
    const url = blobUrl(options, repoPath);
    return url ? `[${codeMd(repoPath)}](${url})` : codeMd(repoPath);
}

// --- problem lines -------------------------------------------------------------

function causeOf(group: FailureGroup): string | undefined {
    return group.rootCauseKind === "changed_file" ? group.rootCause : undefined;
}

function problemSummary(group: FailureGroup): string {
    const { label } = CATEGORY[group.category];
    const first = group.failures[0].failure;
    const where = group.failures.length === 1
        ? `<code>${html(`${basename(first.file)}:${first.line}`)}</code>`
        : `${group.failures.length} tests`;
    const cause = causeOf(group);
    const parts = [
        `<b>${label}</b>`,
        where,
        html(shortReason(first)),
        cause ? `likely cause <code>${html(cause)}</code>` : "",
    ].filter(Boolean);
    return parts.join(" · ");
}

function problemDetails(group: FailureGroup, options: CommentOptions): string {
    const lines: string[] = [];

    for (const item of group.failures) {
        const f = item.failure;
        const extras = [f.title ? md(f.title) : "", f.project ? md(f.project) : ""].filter(Boolean).join(" · ");
        lines.push(`- ${testLink(options, f)}${extras ? ` · ${extras}` : ""}`);
    }

    const cause = causeOf(group);
    if (cause) {
        const attr = group.failures.find((f) => f.attribution?.path === cause)?.attribution;
        const commit = group.commit
            ? ` · commit ${codeMd(shortSha(group.commit))}${attr?.commitSubject ? ` "${md(clip(attr.commitSubject, 60))}"` : ""}`
            : "";
        lines.push("", `**Likely cause:** ${fileLink(options, cause)} (${group.confidence}%)${commit}`);
        // AI evidence is shown in full on the AI line below; don't repeat it here.
        if (attr && !attr.evidence.startsWith("AI read the diff")) lines.push(`<sub>${md(attr.evidence)}</sub>`);
    }

    // AI: the PR-level root cause (saw the diff) beats the per-failure note (saw only the page).
    const aiCause = group.failures.find((f) => f.aiCause)?.aiCause;
    const aiNote = group.failures.find((f) => f.failure.aiNote)?.failure.aiNote;
    if (aiCause) {
        lines.push("", `**AI:** ${md(aiCause.summary)}${aiCause.path ? "" : " (couldn't tie it to a changed file)"}`);
        if (aiCause.fix) lines.push(`**Fix:** ${md(aiCause.fix)}`);
    } else if (aiNote) {
        lines.push("", `**AI:** ${md(aiNote)}`);
    }

    // One line of evidence: the reason this was classified the way it was.
    const c = group.failures[0].classification;
    const why = c.reasons.filter((r) => !r.startsWith("Likely related change")).join(" ");
    lines.push("", `**Why ${CATEGORY[group.category].label.toLowerCase()}:** ${md(why)} (${c.confidence}%)`);

    const error = stripAnsi(group.failures[0].failure.errorMessage ?? "").trim();
    if (error) {
        const errorLines = error.split("\n").filter((l) => l.trim());
        const callLog = errorLines.findIndex((l) => /^\s*Call log:/.test(l));
        const snippet = (callLog >= 0 ? errorLines.slice(0, callLog) : errorLines).slice(0, 6).join("\n");
        lines.push("", "```", snippet.replace(/```/g, "'''"), "```");
    }

    return lines.join("\n");
}

function problemBlock(group: FailureGroup, options: CommentOptions): string {
    return `<details><summary>${problemSummary(group)}</summary>\n\n${problemDetails(group, options)}\n\n</details>\n`;
}

// --- comment -------------------------------------------------------------------

function countsLine(report: ReleaseReport, options: CommentOptions): string {
    const c = report.counts;
    const fresh = c.regression + c.flaky + c.infrastructure + c.test_issue + c.unknown;
    const parts = [
        report.testsAnalyzed != null
            ? report.failureCount === 0 ? `all ${report.testsAnalyzed} tests passed` : `${report.testsAnalyzed} tests`
            : "",
        fresh ? `${fresh} new failure${fresh === 1 ? "" : "s"}` : report.failureCount === 0 && report.testsAnalyzed != null ? "" : "no new failures",
        report.preExistingCount ? `${report.preExistingCount} still failing from main` : "",
        report.preExistingFlakyCount ? `${report.preExistingFlakyCount} flaky on main too` : "",
        report.fixedCount ? `${report.fixedCount} fixed` : "",
        options.runUrl ? `[CI run](${options.runUrl})` : "",
    ].filter(Boolean);
    return parts.join(" · ");
}

/** Warnings that need no action from the reader; kept in release-report.json, not rendered. */
const QUIET_WARNING = /no AI analysis available/;

/**
 * One small footer line for non-safe PRs: what AI did and any setup problem
 * worth fixing (e.g. no git base). The score breakdown lives in release-report.json.
 */
function footer(report: ReleaseReport): string {
    if (report.decision === "SAFE TO MERGE") return "";
    const lines: string[] = [];
    if (report.ai) {
        const cost = report.ai.costUsd != null ? ` · ~$${report.ai.costUsd.toFixed(4)}` : "";
        lines.push(`AI root cause: ${md(report.ai.model)}${cost}`);
    }
    for (const w of report.warnings) if (!QUIET_WARNING.test(w)) lines.push(md(w));
    return lines.length ? `\n<sub>${lines.join("<br>")}</sub>\n` : "";
}

function moreSection(report: ReleaseReport, diff: DiffResult | undefined, options: CommentOptions): string {
    const out: string[] = [];

    const existing = report.failures.filter((f) => f.lifecycle === "existing" && f.classification.category !== "flaky");
    if (existing.length) {
        out.push(`**Still failing from main** (not caused by this PR)`);
        for (const e of existing) out.push(`- ${testLink(options, e.failure)} · ${md(shortReason(e.failure))}`);
        out.push("");
    }

    const flakyOnMain = report.failures.filter((f) => f.lifecycle === "existing" && f.classification.category === "flaky");
    if (flakyOnMain.length) {
        out.push(`**Flaky on main too** (passed on retry, not caused by this PR)`);
        for (const e of flakyOnMain) out.push(`- ${testLink(options, e.failure)}`);
        out.push("");
    }

    const fixed = diff?.fixedFailures ?? [];
    if (fixed.length) {
        out.push("**Fixed by this PR**");
        for (const f of fixed) out.push(`- ${testLink(options, f)}`);
        out.push("");
    }

    if (out.length === 0) return "";

    const label = [
        existing.length ? `Still failing from main (${existing.length})` : "",
        flakyOnMain.length ? `Flaky on main too (${flakyOnMain.length})` : "",
        fixed.length ? `Fixed by this PR (${fixed.length})` : "",
    ].filter(Boolean).join(" · ");

    return `<details><summary>${label}</summary>\n\n${out.join("\n").trim()}\n\n</details>\n`;
}

/**
 * GitHub alert box for the verdict: CAUTION (red) for BLOCK, IMPORTANT (purple)
 * for REVIEW REQUIRED, WARNING (yellow) for a safe PR that still had flaky or
 * infrastructure failures. A clean safe PR gets no box at all.
 */
export function verdictAlert(report: ReleaseReport): "CAUTION" | "IMPORTANT" | "WARNING" | null {
    if (report.decision === "BLOCK") return "CAUTION";
    if (report.decision === "REVIEW REQUIRED") return "IMPORTANT";
    const c = report.counts;
    return c.flaky + c.infrastructure + c.regression + c.test_issue + c.unknown > 0 ? "WARNING" : null;
}

function verdictBlock(report: ReleaseReport): string {
    const alert = verdictAlert(report);
    // SAFE needs no risk score; the verdict says it all.
    const title = report.decision === "SAFE TO MERGE"
        ? `**${report.decision}**`
        : `**${report.decision}** · ${report.risk.level} risk (${report.risk.score}/100)`;

    if (!alert) {
        // Clean run: the counts line already says what happened.
        const reason = report.failureCount > 0 || report.fixedCount > 0 ? `${md(report.decisionReason)}\n\n` : "";
        return `### ${report.decision}\n\n${reason}`;
    }
    return `> [!${alert}]\n> ${title}\n>\n> ${md(report.decisionReason)}\n\n`;
}

/** Compact PR comment: decision, one line, one collapsible line per problem. */
export function formatReleaseComment(
    report: ReleaseReport,
    diff?: DiffResult,
    options: CommentOptions = {}
): string {
    const commit = options.commit ?? process.env.GITHUB_SHA ?? "";

    let body = `${GUARDIAN_COMMENT_HEADER}\n\n`;
    body += verdictBlock(report);
    // With several problems, a short AI overview before the list; one problem explains itself.
    if (report.aiOverview && report.groups.length >= MIN_PROBLEMS_FOR_OVERVIEW) {
        body += `**AI summary:** ${md(report.aiOverview)}\n\n`;
    }
    body += `<sub>${countsLine(report, options)}${commit ? ` · ${codeMd(shortSha(commit))}` : ""}</sub>\n\n`;

    const shown = report.groups.slice(0, MAX_PROBLEM_LINES);
    for (const group of shown) body += problemBlock(group, options);

    const hidden = report.groups.slice(MAX_PROBLEM_LINES);
    if (hidden.length) {
        body += `<details><summary>…and ${hidden.length} more problem${hidden.length === 1 ? "" : "s"}</summary>\n\n`;
        for (const group of hidden) body += problemBlock(group, options);
        body += "\n</details>\n";
    }

    if (shown.length) body += "\n";
    body += moreSection(report, diff, options);
    body += footer(report);
    return body;
}

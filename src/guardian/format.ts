import { INFRASTRUCTURE_PATTERN, stripAnsi } from "../lib/failureSignals";
import type { DiffResult, Failure } from "../lib/types";
import type { FailureCategory, FailureGroup, ReleaseDecision, ReleaseReport } from "./types";

export const GUARDIAN_COMMENT_HEADER = "## AI Release Guardian";

/** Problems listed one line each; the rest go behind "and N more". */
export const MAX_PROBLEM_LINES = 10;

const DECISION_ICON: Record<ReleaseDecision, string> = {
    "SAFE TO MERGE": "✅",
    "REVIEW REQUIRED": "⚠️",
    BLOCK: "⛔",
};

const CATEGORY: Record<FailureCategory, { icon: string; label: string }> = {
    regression: { icon: "🔴", label: "Regression" },
    test_issue: { icon: "🧪", label: "Broken test" },
    unknown: { icon: "❓", label: "Unclear" },
    infrastructure: { icon: "🌐", label: "Infrastructure" },
    flaky: { icon: "🔁", label: "Flaky" },
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
    const { icon, label } = CATEGORY[group.category];
    const first = group.failures[0].failure;
    const where = group.failures.length === 1
        ? `<code>${html(`${basename(first.file)}:${first.line}`)}</code>`
        : `${group.failures.length} tests`;
    const cause = causeOf(group);
    const parts = [
        `${icon} <b>${label}</b>`,
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
        lines.push(`- ${testLink(options, f)}${extras ? ` — ${extras}` : ""}`);
    }

    const cause = causeOf(group);
    if (cause) {
        const attr = group.failures.find((f) => f.attribution?.path === cause)?.attribution;
        const commit = group.commit
            ? ` · commit ${codeMd(shortSha(group.commit))}${attr?.commitSubject ? ` "${md(clip(attr.commitSubject, 60))}"` : ""}`
            : "";
        lines.push("", `**Likely cause:** ${fileLink(options, cause)} (${group.confidence}%)${commit}`);
        if (attr) lines.push(`<sub>${md(attr.evidence)}</sub>`);
    }

    // One line of evidence: the reason this was classified the way it was.
    const c = group.failures[0].classification;
    const why = c.reasons.filter((r) => !r.startsWith("Likely related change")).join(" ");
    lines.push("", `**Why ${CATEGORY[group.category].label.toLowerCase()}:** ${md(why)} (${c.confidence}%)`);

    const error = stripAnsi(group.failures[0].failure.errorMessage ?? "").trim();
    if (error) {
        const lines = error.split("\n").filter((l) => l.trim());
        const callLog = lines.findIndex((l) => /^\s*Call log:/.test(l));
        const snippet = (callLog >= 0 ? lines.slice(0, callLog) : lines).slice(0, 6).join("\n");
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
        report.testsAnalyzed != null ? `${report.testsAnalyzed} tests` : "",
        fresh ? `${fresh} new failure${fresh === 1 ? "" : "s"}` : "no new failures",
        report.preExistingCount ? `${report.preExistingCount} still failing from main` : "",
        report.fixedCount ? `${report.fixedCount} fixed` : "",
        options.runUrl ? `[CI run](${options.runUrl})` : "",
    ].filter(Boolean);
    return parts.join(" · ");
}

function moreSection(report: ReleaseReport, diff: DiffResult | undefined, options: CommentOptions): string {
    const out: string[] = [];

    const existing = report.failures.filter((f) => f.lifecycle === "existing");
    if (existing.length) {
        out.push(`**Still failing from main** (not caused by this PR)`);
        for (const e of existing) out.push(`- ${testLink(options, e.failure)} · ${md(shortReason(e.failure))}`);
        out.push("");
    }

    const fixed = diff?.fixedFailures ?? [];
    if (fixed.length) {
        out.push("**Fixed by this PR**");
        for (const f of fixed) out.push(`- ${testLink(options, f)}`);
        out.push("");
    }

    out.push(`**Risk ${report.risk.score}/100:** ${report.risk.reasons.map(md).join(", ")}`);
    out.push("<sub>0–29 LOW · 30–59 MEDIUM · 60–79 HIGH · 80–100 CRITICAL</sub>");

    if (report.warnings.length) {
        out.push("", ...report.warnings.map((w) => `<sub>⚠ ${md(w)}</sub>`));
    }

    const label = [
        existing.length ? `still failing (${existing.length})` : "",
        fixed.length ? `fixed (${fixed.length})` : "",
        "score",
    ].filter(Boolean).join(", ");

    return `<details><summary>More: ${label}</summary>\n\n${out.join("\n")}\n\n</details>\n`;
}

/** Compact PR comment: decision, one line, one collapsible line per problem. */
export function formatReleaseComment(
    report: ReleaseReport,
    diff?: DiffResult,
    options: CommentOptions = {}
): string {
    const commit = options.commit ?? process.env.GITHUB_SHA ?? "";
    const icon = DECISION_ICON[report.decision];

    let body = `${GUARDIAN_COMMENT_HEADER}\n\n`;
    body += `### ${icon} ${report.decision} · ${report.risk.level} risk (${report.risk.score}/100)\n\n`;
    body += `${md(report.decisionReason)}\n\n`;
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
    return body;
}

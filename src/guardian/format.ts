import { formatDiffSections } from "../lib/format";
import type { DiffResult } from "../lib/types";
import type { ClassifiedFailure, FailureGroup, ReleaseDecision, ReleaseReport } from "./types";

export const GUARDIAN_COMMENT_HEADER = "## AI Release Guardian";

const DECISION_ICON: Record<ReleaseDecision, string> = {
    "SAFE TO MERGE": "✅",
    "REVIEW REQUIRED": "⚠️",
    BLOCK: "⛔",
};

const CATEGORY_LABEL: Record<string, string> = {
    regression: "regression",
    flaky: "flaky",
    infrastructure: "infrastructure",
    test_issue: "test issue",
    unknown: "unknown",
};

/** Inline code that can't be broken out of by backticks in user-controlled text. */
function code(text: string): string {
    return `\`${text.replace(/`/g, "'").replace(/\n/g, " ")}\``;
}

/** Plain text safe for markdown: neutralize HTML and mention/link syntax. */
function plain(text: string): string {
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@(\w)/g, "@​$1");
}

function shortSha(sha: string): string {
    return sha.slice(0, 7);
}

function failureLine(item: ClassifiedFailure): string {
    const f = item.failure;
    const title = f.title ? ` — ${plain(f.title)}` : "";
    const browser = f.project ? ` [${plain(f.project)}]` : "";
    return `- ${code(`${f.file}:${f.line}`)}${title}${browser} · ${CATEGORY_LABEL[item.classification.category]} ${item.classification.confidence}%`;
}

function firstLine(text: string | undefined): string {
    return (text ?? "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "";
}

function formatGroup(group: FailureGroup): string {
    const n = group.failures.length;
    const shared = group.rootCauseKind !== "single";
    // A lone failure has no shared cause to be confident about, unless a changed file is implicated.
    const showConfidence = group.rootCauseKind === "changed_file" || n > 1;
    const confidence = showConfidence ? ` · ${group.confidence}% confidence` : "";
    let out = `#### ${group.id} · ${CATEGORY_LABEL[group.category]} · ${n} test${n === 1 ? "" : "s"}${confidence}\n\n`;

    if (group.rootCauseKind === "changed_file") {
        out += `Probable cause: ${code(group.rootCause)}${group.commit ? ` (commit ${code(shortSha(group.commit))})` : ""}\n\n`;
        out += `${plain(group.reason)}\n\n`;
    } else if (shared && n > 1) {
        out += `Shared error: ${code(firstLine(group.failures[0].failure.errorMessage) || group.rootCause)}\n\n`;
    } else {
        const error = firstLine(group.failures[0].failure.errorMessage);
        if (error) out += `Error: ${code(error)}\n\n`;
    }

    for (const item of group.failures) {
        out += `${failureLine(item)}\n`;
        for (const reason of item.classification.reasons) out += `  - ${plain(reason)}\n`;
    }
    return out + "\n";
}

/** Full PR comment / step-summary markdown for a release report. */
export function formatReleaseComment(
    report: ReleaseReport,
    diff?: DiffResult,
    options: { commit?: string } = {}
): string {
    const commit = options.commit ?? process.env.GITHUB_SHA;
    const c = report.counts;
    const newCount = c.regression + c.flaky + c.infrastructure + c.test_issue + c.unknown;

    let body = `${GUARDIAN_COMMENT_HEADER}\n\n`;
    body += `### ${DECISION_ICON[report.decision]} ${report.decision}\n\n`;
    body += `${plain(report.decisionReason)}\n\n`;

    body += `**Release risk: ${report.risk.level}** · Score: ${report.risk.score}/100\n\n`;

    const stats = [
        report.testsAnalyzed != null ? `Tests analyzed: ${report.testsAnalyzed}` : "",
        `Failures: ${report.failureCount}`,
        `New: ${newCount}`,
        report.preExistingCount ? `Pre-existing: ${report.preExistingCount}` : "",
        report.fixedCount ? `Fixed: ${report.fixedCount}` : "",
        commit ? `Commit: ${code(shortSha(commit))}` : "",
    ].filter(Boolean);
    body += `${stats.join(" · ")}\n\n`;

    if (newCount > 0) {
        body += "**Classification (new failures)**\n\n";
        body += `- Real regressions: ${c.regression}\n`;
        body += `- Flaky: ${c.flaky}\n`;
        body += `- Infrastructure: ${c.infrastructure}\n`;
        body += `- Test issues: ${c.test_issue}\n`;
        if (c.unknown) body += `- Unknown: ${c.unknown}\n`;
        body += "\n";
    }

    // Only name a root cause when a changed file is actually implicated.
    const primary = report.primaryGroup;
    if (primary?.rootCauseKind === "changed_file") {
        body += `**Probable root cause:** ${code(primary.rootCause)} (${primary.confidence}% confidence)\n\n`;
        if (primary.commit) {
            const subject = primary.failures.find((f) => f.attribution?.commitSubject)?.attribution?.commitSubject;
            body += `**Likely introduced by:** commit ${code(shortSha(primary.commit))}${subject ? ` — ${plain(subject)}` : ""}\n\n`;
        }
    }

    if (report.affectedAreas.length > 0) {
        body += `**Affected areas:** ${report.affectedAreas.map(plain).join(", ")}\n\n`;
    }

    if (report.groups.length > 0) {
        body += "### Root-cause groups\n\n";
        for (const group of report.groups) body += formatGroup(group);
    }

    body += "<details><summary>How the risk score was calculated</summary>\n\n";
    for (const reason of report.risk.reasons) body += `- ${plain(reason)}\n`;
    body += "\nLevels: 0–29 LOW · 30–59 MEDIUM · 60–79 HIGH · 80–100 CRITICAL. Pre-existing failures don't add risk.\n\n</details>\n\n";

    if (report.warnings.length > 0) {
        body += "**Evidence gaps**\n\n";
        for (const w of report.warnings) body += `- ${plain(w)}\n`;
        body += "\n";
    }

    if (diff) {
        const sections = formatDiffSections(diff, { gateNote: false });
        if (sections.trim()) {
            body += `<details><summary>Failure diff vs base branch</summary>\n\n${sections}</details>\n`;
        }
    }

    return body;
}

import { AiFailure, DiffResult, FlakyWatchlistEntry } from "./types";

function formatWatchlistSection(entries: FlakyWatchlistEntry[]): string {
    if (entries.length === 0) return "";

    let section = `### Flaky Watchlist (${entries.length})\n\n`;
    section +=
        "For visibility only — intermittent across recent CI runs. **Does not block merge.**\n\n";

    for (const entry of entries) {
        section += `• ${entry.testFile} — unstable in ${entry.failCount} of last ${entry.totalRuns} CI runs\n`;
    }

    return section + "\n";
}

function recurrenceSuffix(f: AiFailure): string {
    if (f.occurrence_count == null) return "";
    const n = f.occurrence_count;
    const date = f.first_seen
        ? new Date(f.first_seen).toISOString().slice(0, 10)
        : "";
    if (n === 1) return " (first time)";
    const ord =
        n % 10 === 1 && n % 100 !== 11
            ? "st"
            : n % 10 === 2 && n % 100 !== 12
              ? "nd"
              : n % 10 === 3 && n % 100 !== 13
                ? "rd"
                : "th";
    return date ? ` (${n}${ord} time since ${date})` : ` (${n}×)`;
}

function formatSection(
    title: string,
    list: AiFailure[],
    includeSeverity = true
): string {
    if (list.length === 0) return "";

    let section = `### ${title} (${list.length})\n\n`;

    for (const item of list) {
        const severityPart = includeSeverity
            ? ` | severity: ${item.severity}`
            : "";
        const recur = recurrenceSuffix(item);

        section += `• ${item.file}:${item.line} | ${item.failure_type}${severityPart} | confidence: ${item.confidence}${recur}\n`;
    }

    return section + "\n";
}

export function formatDiffComment(diff: DiffResult): string {
    const unchangedFailures = diff.unchangedFailures ?? [];
    const newFailures = diff.newFailures ?? [];
    const fixedFailures = diff.fixedFailures ?? [];

    const flaky = newFailures.filter((f) => f.is_flaky_suspected);
    const realNewFailures = newFailures.filter((f) => !f.is_flaky_suspected);

    const commit = process.env.GITHUB_SHA?.slice(0, 7);

    let body = "## AI Failure Diff Summary\n\n";
    if (commit) body += `Commit: ${commit}\n`;
    body += "\n";

    if (unchangedFailures.length > 0) {
        body +=
            "⚠️ **Pre-existing failures** from the base branch are still failing. These are shown for visibility only — **they do not block this PR**. Only **New Issues** block merge.\n\n";
    }

    body += formatSection("New Issues", realNewFailures);
    body += formatSection("Flaky", flaky, false);
    body += formatSection("Still Failing", unchangedFailures);
    body += formatSection("Fixed Issues", fixedFailures);
    body += formatWatchlistSection(diff.flakyWatchlist ?? []);

    return body;
}

export function hasFailureChanges(diff: DiffResult): boolean {
    return (
        (diff.newFailures?.length ?? 0) > 0 ||
        (diff.unchangedFailures?.length ?? 0) > 0 ||
        (diff.fixedFailures?.length ?? 0) > 0 ||
        (diff.flakyWatchlist?.length ?? 0) > 0
    );
}

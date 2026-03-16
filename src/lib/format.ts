import { AiFailure, DiffResult } from "./types";

function formatList(title: string, list: AiFailure[]): string {
    if (list.length === 0) return "";
    let section = `### ${title} (${list.length})\n\n`;
    for (const item of list) {
        let line = `- ${item.file}:${item.line} | ${item.failure_type} | severity: ${item.severity} | confidence: ${item.confidence}`;

        const occurrence = (item as any).occurrence_count;
        const firstSeen = (item as any).first_seen;

        if (occurrence && firstSeen) {
            const date = new Date(firstSeen).toISOString().slice(0, 10);
            const suffix =
                occurrence === 1
                    ? ` (failed once since ${date})`
                    : ` (failed ${occurrence} times since ${date})`;
            line += suffix;
        }

        section += line + "\n";
    }
    return section + "\n";
}

export function formatDiffComment(diff: DiffResult): string {
    const unchanged = (diff as any).unchangedFailures ?? [];

    const baselineCount = unchanged.length + diff.fixedFailures.length;
    const currentCount = unchanged.length + diff.newFailures.length;

    const header =
        "## AI Failure Diff Summary\n\n" +
        `Baseline: ${baselineCount} failures\n` +
        `Current: ${currentCount} failures\n\n`;

    const newSection = formatList("New Failures", diff.newFailures);
    const fixedSection = formatList("Fixed Failures", diff.fixedFailures);

    const none =
        diff.newFailures.length === 0 && diff.fixedFailures.length === 0
            ? "_No changes in failures vs baseline._\n\n"
            : "";

    return header + none + newSection + fixedSection;
}
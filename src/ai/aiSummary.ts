import path from "path";
import { AiUsage } from "./types";
import { formatUsd } from "./estimateCost";

export interface AiSummaryEntry {
    metaPath: string;
    relativePath: string;
    content: string;
    usage?: AiUsage;
    estimatedCostUsd?: number;
}

export interface AiSummaryInput {
    provider?: string;
    model?: string;
    entries: AiSummaryEntry[];
}

export const AI_SUMMARY_MARKDOWN_FILENAME = "ai-summary.md";
export const AI_SUMMARY_DATA_FILENAME = "ai-summary.json";

export function titleFromMetaPath(metaPath: string): string {
    const normalized = metaPath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const attemptIdx = parts.findIndex((p) => /^attempt-\d+$/.test(p));

    if (attemptIdx >= 2) {
        return parts.slice(attemptIdx - 2, attemptIdx + 1).join("/");
    }

    return path.basename(path.dirname(metaPath));
}

export function totalEstimatedCostUsd(
    entries: AiSummaryEntry[]
): number | undefined {
    const costs = entries
        .map((e) => e.estimatedCostUsd)
        .filter((c): c is number => typeof c === "number");

    if (costs.length === 0) return undefined;
    return costs.reduce((sum, c) => sum + c, 0);
}

export function formatCostRollupLine(input: AiSummaryInput): string {
    const { provider, model, entries } = input;
    const total = totalEstimatedCostUsd(entries);
    const providerLabel =
        provider && model ? `${provider} (${model})` : provider ?? "unknown";

    const parts = [
        `AI analysis: ${entries.length} failure${entries.length === 1 ? "" : "s"}`,
        providerLabel,
    ];
    if (total !== undefined) {
        parts.push(`~${formatUsd(total)} estimated`);
    }

    return parts.join(" · ");
}

export function formatAiSummaryMarkdown(input: AiSummaryInput): string {
    const { provider, model, entries } = input;
    const total = totalEstimatedCostUsd(entries);
    const lines: string[] = [
        "# AI failure analysis summary",
        "",
        `- Provider: ${provider ?? "unknown"}${model ? ` (${model})` : ""}`,
        `- Failures analyzed: ${entries.length}`,
    ];

    if (total !== undefined) {
        lines.push(`- Estimated cost (approx): ${formatUsd(total)}`);
    }

    lines.push("");

    for (const entry of entries) {
        lines.push("---", "", `## ${titleFromMetaPath(entry.metaPath)}`, "");
        lines.push(`Path: \`${entry.relativePath}\``);
        if (entry.estimatedCostUsd !== undefined) {
            lines.push(`Cost (approx): ${formatUsd(entry.estimatedCostUsd)}`);
        }
        if (entry.usage) {
            const { inputTokens, outputTokens, totalTokens } = entry.usage;
            const tokenBits = [
                inputTokens !== undefined ? `in ${inputTokens}` : null,
                outputTokens !== undefined ? `out ${outputTokens}` : null,
                totalTokens !== undefined ? `total ${totalTokens}` : null,
            ].filter(Boolean);
            if (tokenBits.length > 0) {
                lines.push(`Tokens: ${tokenBits.join(", ")}`);
            }
        }
        lines.push("", entry.content.trim(), "");
    }

    return lines.join("\n").trimEnd() + "\n";
}

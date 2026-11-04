import { errorSignature } from "../lib/failureSignals";
import type { ClassifiedFailure, FailureCategory, FailureGroup } from "./types";

const CATEGORY_PRIORITY: FailureCategory[] = ["regression", "test_issue", "unknown", "infrastructure", "flaky"];

function groupKey(item: ClassifiedFailure): { key: string; kind: FailureGroup["rootCauseKind"]; rootCause: string } {
    const { category } = item.classification;
    const attr = item.attribution;

    // Product-facing failures that point at the same changed source file share a cause.
    if (attr && attr.kind !== "test_file" && (category === "regression" || category === "unknown")) {
        return { key: `file:${attr.path}`, kind: "changed_file", rootCause: attr.path };
    }

    const signature = errorSignature(item.failure.errorMessage);
    if (signature) {
        return { key: `sig:${category}:${signature}`, kind: "error_signature", rootCause: signature };
    }

    const id = `${item.failure.file}:${item.failure.line}:${item.failure.failure_type}`;
    return { key: `single:${id}`, kind: "single", rootCause: `${item.failure.failure_type} at ${item.failure.file}:${item.failure.line}` };
}

function dominantCategory(items: ClassifiedFailure[]): FailureCategory {
    const present = new Set(items.map((i) => i.classification.category));
    return CATEGORY_PRIORITY.find((c) => present.has(c)) ?? "unknown";
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function describe(group: Omit<FailureGroup, "reason" | "id">): string {
    const specs = unique(group.failures.map((f) => f.failure.file));
    const n = group.failures.length;
    const tests = `${n} failing test${n === 1 ? "" : "s"}${specs.length > 1 ? ` across ${specs.length} spec files` : ""}`;

    if (group.rootCauseKind === "changed_file") {
        const evidence = group.failures.find((f) => f.attribution)?.attribution?.evidence ?? "";
        return `${tests} ${n === 1 ? "relates" : "relate"} to ${group.rootCause}, which changed in this PR${group.commit ? ` (commit ${group.commit.slice(0, 7)})` : ""}. ${evidence}`.trim();
    }
    if (group.rootCauseKind === "error_signature" && n > 1) {
        return `${tests} fail with the same error.`;
    }
    return group.failures[0].classification.reasons[0] ?? "";
}

function groupConfidence(kind: FailureGroup["rootCauseKind"], items: ClassifiedFailure[]): number {
    const specCount = unique(items.map((i) => i.failure.file)).length;

    if (kind === "changed_file") {
        const best = Math.max(...items.map((i) => i.attribution?.confidence ?? 0));
        // Several independent suites pointing at the same file corroborate each other.
        return Math.min(90, best + (specCount > 1 ? 10 : 0) + (specCount > 2 ? 5 : 0));
    }
    if (kind === "error_signature" && items.length > 1) return 55;
    return 30;
}

/**
 * Groups failures by probable shared root cause: same implicated changed
 * file first, then identical normalized error signature. Deterministic.
 */
export function groupFailures(items: ClassifiedFailure[]): FailureGroup[] {
    const buckets = new Map<string, { kind: FailureGroup["rootCauseKind"]; rootCause: string; items: ClassifiedFailure[] }>();

    for (const item of items) {
        const { key, kind, rootCause } = groupKey(item);
        const bucket = buckets.get(key) ?? { kind, rootCause, items: [] };
        bucket.items.push(item);
        buckets.set(key, bucket);
    }

    const groups = [...buckets.values()].map(({ kind, rootCause, items: members }) => {
        const commit = members.find((m) => m.attribution?.commit)?.attribution?.commit;
        const base = {
            category: dominantCategory(members),
            rootCause,
            rootCauseKind: kind,
            ...(kind === "changed_file" && commit ? { commit } : {}),
            confidence: groupConfidence(kind, members),
            areas: unique(members.map((m) => m.area)),
            failures: members,
        };
        return { ...base, reason: describe(base) };
    });

    groups.sort(
        (a, b) =>
            CATEGORY_PRIORITY.indexOf(a.category) - CATEGORY_PRIORITY.indexOf(b.category) ||
            b.failures.length - a.failures.length ||
            b.confidence - a.confidence
    );

    return groups.map((g, i) => ({ id: `G${i + 1}`, ...g }));
}

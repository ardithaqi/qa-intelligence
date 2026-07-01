import path from "path";

export interface FailureMeta {
    is_flaky_suspected?: boolean;
}

export function testKeyFromMetaPath(metaPath: string): string {
    return path.dirname(path.dirname(metaPath));
}

export function parseAttemptFromMetaPath(metaPath: string): number {
    const normalized = metaPath.replace(/\\/g, "/");
    const match = normalized.match(/\/attempt-(\d+)\/meta\.json$/);
    if (!match) return 0;
    const attempt = Number(match[1]);
    return Number.isFinite(attempt) ? attempt : 0;
}

function highestAttemptPath(paths: string[]): string {
    return paths.reduce((best, current) =>
        parseAttemptFromMetaPath(current) >= parseAttemptFromMetaPath(best)
            ? current
            : best
    );
}

/** Pick one meta.json per test: flaky pass attempt, else last failed attempt. */
export function selectMetaFilesForAnalysis(
    metaPaths: string[],
    readMeta: (metaPath: string) => FailureMeta | null
): string[] {
    const byTest = new Map<string, string[]>();

    for (const metaPath of metaPaths) {
        const key = testKeyFromMetaPath(metaPath);
        const group = byTest.get(key) ?? [];
        group.push(metaPath);
        byTest.set(key, group);
    }

    const selected: string[] = [];

    for (const group of byTest.values()) {
        const flaky = group.filter((p) => readMeta(p)?.is_flaky_suspected);
        selected.push(highestAttemptPath(flaky.length > 0 ? flaky : group));
    }

    return selected;
}

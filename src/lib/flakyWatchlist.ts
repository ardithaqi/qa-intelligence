import { normalizeTestPath } from "./failureIdentity";
import type { DiffResult, FlakyWatchlistEntry, History } from "./types";

export const DEFAULT_MIN_RUNS = 3;
export const DEFAULT_MIN_FAIL_COUNT = 2;

export function testFileFromFailureKey(failureKey: string): string {
    const idx = failureKey.lastIndexOf(":");
    return idx >= 0 ? failureKey.slice(0, idx) : failureKey;
}

export function testFileFromFailure(failure: { file: string }): string {
    return normalizeTestPath(failure.file);
}

/**
 * Tests that appeared in the failure report on some CI runs but not all
 * (intermittent), using failure keys stored in the history cache.
 */
export function computeFlakyWatchlist(
    history: History,
    options?: { minRuns?: number; minFailCount?: number }
): FlakyWatchlistEntry[] {
    const minRuns = options?.minRuns ?? DEFAULT_MIN_RUNS;
    const minFailCount = options?.minFailCount ?? DEFAULT_MIN_FAIL_COUNT;
    const runs = history.runs;
    const totalRuns = runs.length;

    if (totalRuns < minRuns) return [];

    const failCountByTest = new Map<string, number>();

    for (const run of runs) {
        const filesInRun = new Set<string>();
        for (const key of run.failureKeys) {
            filesInRun.add(testFileFromFailureKey(key));
        }
        for (const file of filesInRun) {
            failCountByTest.set(file, (failCountByTest.get(file) ?? 0) + 1);
        }
    }

    const entries: FlakyWatchlistEntry[] = [];

    for (const [testFile, failCount] of failCountByTest) {
        if (failCount >= minFailCount && failCount < totalRuns) {
            entries.push({
                testFile,
                failCount,
                totalRuns,
                failRate: failCount / totalRuns,
            });
        }
    }

    return entries.sort(
        (a, b) => b.failCount - a.failCount || b.failRate - a.failRate
    );
}

/** Drop tests already surfaced as Still Failing or New Issues on this PR. */
export function filterWatchlistForCurrentDiff(
    entries: FlakyWatchlistEntry[],
    diff: Pick<DiffResult, "newFailures" | "unchangedFailures">
): FlakyWatchlistEntry[] {
    const exclude = new Set<string>();

    for (const f of diff.unchangedFailures ?? []) {
        exclude.add(testFileFromFailure(f));
    }
    for (const f of diff.newFailures ?? []) {
        if (!f.is_flaky_suspected) {
            exclude.add(testFileFromFailure(f));
        }
    }

    return entries.filter((entry) => !exclude.has(entry.testFile));
}

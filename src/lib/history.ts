import fs from "fs";
import path from "path";
import { failureDiffKey } from "./failureIdentity";
import type { DiffResult } from "./types";

export const MAX_RUNS = 20;

export interface Failure {
    file: string;
    line: number;
    failure_type: string;
    severity: string;
    confidence: number;
    is_flaky_suspected?: boolean;
}

export interface EnrichedFailure extends Failure {
    first_seen?: string;
    occurrence_count?: number;
}

export interface RunRecord {
    sha: string;
    timestamp: string;
    failureKeys: string[];
}

export interface History {
    runs: RunRecord[];
}

export function failureKey(f: Failure): string {
    return failureDiffKey(f.file, f.failure_type);
}

export function loadHistory(historyPath: string): History {
    if (!fs.existsSync(historyPath)) return { runs: [] };
    try {
        const data = JSON.parse(fs.readFileSync(historyPath, "utf8"));
        return Array.isArray(data.runs) ? { runs: data.runs } : { runs: [] };
    } catch {
        return { runs: [] };
    }
}

export function enrichFailures(
    failures: Failure[],
    history: History,
    thisRun: RunRecord
): EnrichedFailure[] {
    const runsIncludingThis = [...history.runs, thisRun];

    return failures.map((f) => {
        const key = failureKey(f);
        const enriched: EnrichedFailure = { ...f };

        const runsWithThis = runsIncludingThis.filter((r) =>
            r.failureKeys.includes(key)
        );
        if (runsWithThis.length > 0) {
            enriched.occurrence_count = runsWithThis.length;
            enriched.first_seen = runsWithThis[0].timestamp;
        }
        return enriched;
    });
}

export function appendHistoryRun(
    history: History,
    run: RunRecord,
    maxRuns = MAX_RUNS
): History {
    return {
        runs: [...history.runs, run].slice(-maxRuns),
    };
}

export function collectCurrentKeys(failures: Failure[]): Set<string> {
    const keys = new Set<string>();
    for (const f of failures) {
        keys.add(failureKey(f));
    }
    return keys;
}

export function saveHistory(historyPath: string, history: History): void {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

export function enrichDiffWithHistory(
    diff: DiffResult,
    historyPath: string,
    runMeta?: { sha?: string; timestamp?: string }
): DiffResult {
    const history = loadHistory(historyPath);
    const currentKeys = collectCurrentKeys([
        ...(diff.newFailures ?? []),
        ...(diff.unchangedFailures ?? []),
    ]);
    const thisRun: RunRecord = {
        sha: runMeta?.sha ?? "",
        timestamp: runMeta?.timestamp ?? new Date().toISOString(),
        failureKeys: [...currentKeys],
    };

    const result: DiffResult = {
        newFailures: enrichFailures(diff.newFailures ?? [], history, thisRun),
        unchangedFailures: enrichFailures(
            diff.unchangedFailures ?? [],
            history,
            thisRun
        ),
        fixedFailures: enrichFailures(diff.fixedFailures ?? [], history, thisRun),
        blockingFailures: diff.blockingFailures,
    };

    saveHistory(historyPath, appendHistoryRun(history, thisRun));
    return result;
}

import { AiFailure, DiffResult } from "./types";
import { failureKey } from "./failureReader";

export function computeDiff(
    baseline: AiFailure[],
    current: AiFailure[]
): DiffResult {
    const baselineMap = new Map<string, AiFailure>();
    const currentMap = new Map<string, AiFailure>();

    for (const f of baseline) baselineMap.set(failureKey(f), f);
    for (const f of current) currentMap.set(failureKey(f), f);

    const newFailures: AiFailure[] = [];
    const fixedFailures: AiFailure[] = [];

    for (const [key, cur] of currentMap.entries()) {
        if (!baselineMap.has(key)) newFailures.push(cur);
    }

    for (const [key, base] of baselineMap.entries()) {
        if (!currentMap.has(key)) fixedFailures.push(base);
    }

    // Stable ordering (nice for PR comments)
    const sortFn = (a: AiFailure, b: AiFailure) => {
        const fa = `${a.file}:${a.line}:${a.failure_type}`;
        const fb = `${b.file}:${b.line}:${b.failure_type}`;
        return fa.localeCompare(fb);
    };

    newFailures.sort(sortFn);
    fixedFailures.sort(sortFn);

    return {
        baselineCount: baseline.length,
        currentCount: current.length,
        newFailures,
        fixedFailures,
    };
}
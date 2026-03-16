#!/usr/bin/env node
/**
 * Enriches failure-diff with recurrence: first_seen, occurrence_count.
 * Persists run history in a cache file for the next run.
 */

import fs from "fs";
import path from "path";

const HISTORY_PATH = ".cache/failure-history.json";
const MAX_RUNS = 20;

interface Failure {
    file: string;
    line: number;
    failure_type: string;
    severity: string;
    confidence: number;
    is_flaky_suspected?: boolean;
}

interface EnrichedFailure extends Failure {
    first_seen?: string; // ISO date
    occurrence_count?: number;
}

interface RunRecord {
    sha: string;
    timestamp: string;
    failureKeys: string[];
}

interface History {
    runs: RunRecord[];
}

function failureKey(f: Failure): string {
    return `${f.file}:${f.line}:${f.failure_type}`;
}

function loadHistory(): History {
    if (!fs.existsSync(HISTORY_PATH)) return { runs: [] };
    try {
        const data = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
        return Array.isArray(data.runs) ? { runs: data.runs } : { runs: [] };
    } catch {
        return { runs: [] };
    }
}

function enrichFailures(
    failures: Failure[],
    history: History,
    currentKeys: Set<string>
): EnrichedFailure[] {
    const runsIncludingThis = [...history.runs];
    const thisRun: RunRecord = {
        sha: process.env.GITHUB_SHA ?? "",
        timestamp: new Date().toISOString(),
        failureKeys: [...currentKeys],
    };
    runsIncludingThis.push(thisRun);

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

function main() {
    const diffPath = "failure-diff.json";
    if (!fs.existsSync(diffPath)) {
        console.log("No failure-diff.json, skipping history update.");
        return;
    }

    const diff = JSON.parse(fs.readFileSync(diffPath, "utf8"));
    const { newFailures, unchangedFailures, fixedFailures } = diff;

    const currentKeys = new Set<string>();
    for (const f of [...newFailures, ...unchangedFailures]) {
        currentKeys.add(failureKey(f));
    }

    const history = loadHistory();

    const enrichedNew = enrichFailures(newFailures, history, currentKeys);
    const enrichedUnchanged = enrichFailures(
        unchangedFailures,
        history,
        currentKeys
    );
    const enrichedFixed = enrichFailures(fixedFailures, history, currentKeys);

    const updatedHistory: History = {
        runs: [...history.runs, { sha: process.env.GITHUB_SHA ?? "", timestamp: new Date().toISOString(), failureKeys: [...currentKeys] }].slice(-MAX_RUNS),
    };

    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(
        HISTORY_PATH,
        JSON.stringify(updatedHistory, null, 2)
    );

    const result = {
        newFailures: enrichedNew,
        unchangedFailures: enrichedUnchanged,
        fixedFailures: enrichedFixed,
    };
    fs.writeFileSync(diffPath, JSON.stringify(result, null, 2));
    console.log("Updated failure-diff with recurrence; history runs:", updatedHistory.runs.length);
}

main();

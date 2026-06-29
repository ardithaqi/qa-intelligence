#!/usr/bin/env node
/**
 * Enriches failure-diff with recurrence: first_seen, occurrence_count.
 * Persists run history in a cache file for the next run.
 */

import fs from "fs";
import path from "path";
import {
    appendHistoryRun,
    collectCurrentKeys,
    enrichFailures,
    loadHistory,
} from "../lib/history";

const HISTORY_PATH = ".cache/failure-history.json";

function main() {
    const diffPath = "failure-diff.json";
    if (!fs.existsSync(diffPath)) {
        console.log("No failure-diff.json, skipping history update.");
        return;
    }

    const diff = JSON.parse(fs.readFileSync(diffPath, "utf8"));
    const { newFailures, unchangedFailures, fixedFailures } = diff;

    const currentKeys = collectCurrentKeys([...newFailures, ...unchangedFailures]);
    const history = loadHistory(HISTORY_PATH);
    const thisRun = {
        sha: process.env.GITHUB_SHA ?? "",
        timestamp: new Date().toISOString(),
        failureKeys: [...currentKeys],
    };

    const enrichedNew = enrichFailures(newFailures, history, thisRun);
    const enrichedUnchanged = enrichFailures(
        unchangedFailures,
        history,
        thisRun
    );
    const enrichedFixed = enrichFailures(fixedFailures, history, thisRun);

    const updatedHistory = appendHistoryRun(history, thisRun);

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
    console.log(
        "Updated failure-diff with recurrence; history runs:",
        updatedHistory.runs.length
    );
}

main();

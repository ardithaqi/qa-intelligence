#!/usr/bin/env node
/**
 * Enriches failure-diff with recurrence: first_seen, occurrence_count.
 * Persists run history in a cache file for the next run.
 */

import fs from "fs";
import { enrichDiffWithHistory } from "../lib/history";

const HISTORY_PATH = ".cache/failure-history.json";

function main() {
    const diffPath = "failure-diff.json";
    if (!fs.existsSync(diffPath)) {
        console.log("No failure-diff.json, skipping history update.");
        return;
    }

    const diff = JSON.parse(fs.readFileSync(diffPath, "utf8"));

    const result = enrichDiffWithHistory(diff, HISTORY_PATH, {
        sha: process.env.GITHUB_SHA ?? "",
    });

    fs.writeFileSync(
        diffPath,
        JSON.stringify(
            {
                newFailures: result.newFailures,
                unchangedFailures: result.unchangedFailures,
                fixedFailures: result.fixedFailures,
            },
            null,
            2
        )
    );

    const historyRuns = JSON.parse(
        fs.readFileSync(HISTORY_PATH, "utf8")
    ).runs.length;
    console.log(
        "Updated failure-diff with recurrence; history runs:",
        historyRuns
    );
}

main();

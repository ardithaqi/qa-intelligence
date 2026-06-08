#!/usr/bin/env node
import fs from "fs";
import { computeDiff } from "../lib/computeDiff";

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return process.argv[idx + 1];
}

function getBoolArg(name: string, defaultVal: boolean): boolean {
    const v = getArg(name);
    if (!v) return defaultVal;
    return v === "true" || v === "1" || v === "yes";
}

async function main() {
    const baselineDir = getArg("baseline") ?? "baseline-artifacts";
    const currentDir = getArg("current") ?? "artifacts";
    const outFile = getArg("out") ?? "failure-diff.json";
    const failOnBlocking = getBoolArg("fail-on-blocking", true);

    const diff = computeDiff(baselineDir, currentDir);

    fs.writeFileSync(outFile, JSON.stringify(diff, null, 2));

    console.log(`Wrote diff to ${outFile}`);
    console.log(`New failures: ${diff.newFailures.length}`);
    console.log(`Blocking failures: ${diff.blockingFailures.length}`);
    console.log(`Still failing: ${diff.unchangedFailures.length}`);
    console.log(`Fixed failures: ${diff.fixedFailures.length}`);

    if (failOnBlocking && diff.blockingFailures.length > 0) {
        console.error(
            `Failing job because ${diff.blockingFailures.length} new non-flaky failure(s) were detected.`
        );
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
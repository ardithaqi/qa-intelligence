import fs from "fs";
import path from "path";
import { readFailures } from "../lib/failureReader";
import { computeDiff } from "../lib/diff";

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
    const failOnNew = getBoolArg("fail-on-new", false);

    const baseline = readFailures({ rootDir: baselineDir }).failures;
    const current = readFailures({ rootDir: currentDir }).failures;

    const diff = computeDiff(baseline, current);

    fs.writeFileSync(outFile, JSON.stringify(diff, null, 2));

    console.log(`Wrote diff to ${outFile}`);
    console.log(`New failures: ${diff.newFailures.length}`);
    console.log(`Fixed failures: ${diff.fixedFailures.length}`);

    if (failOnNew && diff.newFailures.length > 0) {
        console.error("Failing job because new failures were detected.");
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
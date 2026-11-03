import fs from "fs";
import path from "path";
import type { FullConfig, FullResult, Reporter, Suite } from "@playwright/test/reporter";
import {
    AI_SUMMARY_DATA_FILENAME,
    AI_SUMMARY_MARKDOWN_FILENAME,
    AiSummaryInput,
    formatCostRollupLine,
} from "../ai/aiSummary";
import { writeRunSummary } from "../guardian/runSummary";
import type { RunSummary } from "../guardian/types";

export function printAiCostSummary(
    result: FullResult,
    root: string = process.cwd()
): void {
    if (process.env.AI_ANALYSIS !== "true") return;
    if (result.duration === 0) return;

    const currentRunFile = path.join(root, "artifacts", ".current-run");
    if (!fs.existsSync(currentRunFile)) return;

    const runDirRaw = fs.readFileSync(currentRunFile, "utf-8").trim();
    if (!runDirRaw) return;

    const runDir = path.isAbsolute(runDirRaw)
        ? runDirRaw
        : path.join(root, runDirRaw);
    if (!fs.existsSync(runDir)) return;

    const dataPath = path.join(runDir, AI_SUMMARY_DATA_FILENAME);
    if (!fs.existsSync(dataPath)) return;

    let summaryInput: AiSummaryInput;
    try {
        summaryInput = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    } catch {
        return;
    }

    console.log(`\n${formatCostRollupLine(summaryInput)}`);
    console.log(
        `Saved AI summary: ${path.join(runDir, AI_SUMMARY_MARKDOWN_FILENAME)}`
    );
}

/** Test totals by final outcome (after retries). */
export function summarizeSuite(suite: Suite, status?: string): RunSummary {
    const summary: RunSummary = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
    if (status) summary.status = status;

    for (const test of suite.allTests()) {
        summary.total++;
        const outcome = test.outcome();
        if (outcome === "expected") summary.passed++;
        else if (outcome === "flaky") summary.flaky++;
        else if (outcome === "skipped") summary.skipped++;
        else summary.failed++;
    }

    return summary;
}

export default class AiSummaryReporter implements Reporter {
    private suite?: Suite;

    onBegin(_config: FullConfig, suite: Suite): void {
        this.suite = suite;
    }

    onEnd(result: FullResult): void {
        // Totals for the release guardian's "Tests analyzed" line. Best effort.
        if (this.suite) {
            try {
                writeRunSummary(path.resolve("artifacts"), summarizeSuite(this.suite, result.status));
            } catch { }
        }
        printAiCostSummary(result);
    }
}

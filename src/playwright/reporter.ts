import fs from "fs";
import path from "path";
import type { FullResult, Reporter } from "@playwright/test/reporter";
import {
    AI_SUMMARY_DATA_FILENAME,
    AI_SUMMARY_MARKDOWN_FILENAME,
    AiSummaryInput,
    formatCostRollupLine,
} from "../ai/aiSummary";

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

export default class AiSummaryReporter implements Reporter {
    onEnd(result: FullResult): void {
        printAiCostSummary(result);
    }
}

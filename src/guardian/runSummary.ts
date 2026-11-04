import fs from "fs";
import path from "path";
import { z } from "zod";
import type { RunSummary } from "./types";

export const RUN_SUMMARY_FILENAME = "run-summary.json";

const RunSummarySchema = z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    status: z.string().optional(),
});

/** Reads `<artifactsDir>/run-summary.json` written by the Playwright reporter. */
export function readRunSummary(artifactsDir: string): RunSummary | undefined {
    const file = path.join(artifactsDir, RUN_SUMMARY_FILENAME);
    if (!fs.existsSync(file)) return undefined;
    try {
        return RunSummarySchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
        return undefined;
    }
}

export function writeRunSummary(artifactsDir: string, summary: RunSummary): void {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, RUN_SUMMARY_FILENAME), JSON.stringify(summary, null, 2));
}

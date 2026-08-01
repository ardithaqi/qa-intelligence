import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FullResult } from "@playwright/test/reporter";
import { printAiCostSummary } from "./reporter";
import { AI_SUMMARY_DATA_FILENAME, AiSummaryInput } from "../ai/aiSummary";

function fullResult(duration: number): FullResult {
    return { status: "passed", duration } as FullResult;
}

function writeCurrentRun(root: string, runDir: string): void {
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(root, "artifacts", ".current-run"), runDir);
}

function writeSummaryData(runDir: string, input: AiSummaryInput): void {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
        path.join(runDir, AI_SUMMARY_DATA_FILENAME),
        JSON.stringify(input)
    );
}

describe("printAiCostSummary", () => {
    let root = "";
    let logs: string[] = [];
    const originalLog = console.log;
    const originalEnv = process.env.AI_ANALYSIS;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-reporter-"));
        logs = [];
        console.log = (msg: string) => {
            logs.push(msg);
        };
    });

    afterEach(() => {
        console.log = originalLog;
        process.env.AI_ANALYSIS = originalEnv;
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("skips when AI_ANALYSIS is not 'true'", () => {
        process.env.AI_ANALYSIS = "false";
        const runDir = path.join(root, "artifacts", "run-1");
        writeCurrentRun(root, runDir);
        writeSummaryData(runDir, {
            provider: "anthropic",
            model: "claude-haiku-4-5",
            entries: [
                {
                    metaPath: "meta.json",
                    relativePath: "ai.txt",
                    content: "root cause",
                    estimatedCostUsd: 0.002226,
                },
            ],
        });

        printAiCostSummary(fullResult(1234), root);

        assert.equal(logs.length, 0);
    });

    it("skips when result.duration is 0 (e.g. --list)", () => {
        process.env.AI_ANALYSIS = "true";
        const runDir = path.join(root, "artifacts", "run-1");
        writeCurrentRun(root, runDir);
        writeSummaryData(runDir, {
            provider: "anthropic",
            model: "claude-haiku-4-5",
            entries: [
                {
                    metaPath: "meta.json",
                    relativePath: "ai.txt",
                    content: "root cause",
                    estimatedCostUsd: 0.002226,
                },
            ],
        });

        printAiCostSummary(fullResult(0), root);

        assert.equal(logs.length, 0);
    });

    it("skips when no run directory has been recorded", () => {
        process.env.AI_ANALYSIS = "true";

        printAiCostSummary(fullResult(1234), root);

        assert.equal(logs.length, 0);
    });

    it("skips when the run had no AI summary data (e.g. all green)", () => {
        process.env.AI_ANALYSIS = "true";
        const runDir = path.join(root, "artifacts", "run-1");
        writeCurrentRun(root, runDir);
        fs.mkdirSync(runDir, { recursive: true });

        printAiCostSummary(fullResult(1234), root);

        assert.equal(logs.length, 0);
    });

    it("prints the rollup and saved summary path when analysis ran", () => {
        process.env.AI_ANALYSIS = "true";
        const runDir = path.join(root, "artifacts", "run-1");
        writeCurrentRun(root, runDir);
        writeSummaryData(runDir, {
            provider: "anthropic",
            model: "claude-haiku-4-5",
            entries: [
                {
                    metaPath: "meta.json",
                    relativePath: "ai.txt",
                    content: "root cause",
                    estimatedCostUsd: 0.002226,
                },
            ],
        });

        printAiCostSummary(fullResult(1234), root);

        assert.equal(logs.length, 2);
        assert.match(
            logs[0],
            /AI analysis: 1 failure · anthropic \(claude-haiku-4-5\) · ~\$0\.002226 estimated/
        );
        assert.equal(
            logs[1],
            `Saved AI summary: ${path.join(runDir, "ai-summary.md")}`
        );
    });
});

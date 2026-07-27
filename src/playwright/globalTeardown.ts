import fs from "fs";
import path from "path";
import {
    AiSummaryEntry,
    formatAiSummaryMarkdown,
    formatCostRollupLine,
} from "../ai/aiSummary";
import { analyzeFailureFile } from "../ai/failureAnalyzer";
import { createAiProvider } from "../ai/getProvider";
import {
    FailureMeta,
    selectMetaFilesForAnalysis,
} from "../lib/selectMetaForAnalysis";

function findMetaFiles(dir: string, results: string[] = []): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            findMetaFiles(fullPath, results);
        } else if (entry.name === "meta.json") {
            results.push(fullPath);
        }
    }

    return results;
}

function readMeta(metaPath: string): FailureMeta | null {
    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf8")) as FailureMeta;
    } catch {
        return null;
    }
}

export async function runAiTeardown(runDir: string): Promise<{
    analyzed: number;
    summaryPath: string | null;
}> {
    const metaFiles = findMetaFiles(runDir);
    if (metaFiles.length === 0) {
        return { analyzed: 0, summaryPath: null };
    }

    const toAnalyze = selectMetaFilesForAnalysis(metaFiles, readMeta);
    if (toAnalyze.length === 0) {
        return { analyzed: 0, summaryPath: null };
    }

    const provider = createAiProvider();
    if (provider) {
        console.log(
            `Using AI provider: ${provider.name} (${provider.model})`
        );
    }

    const entries: AiSummaryEntry[] = [];

    for (const metaPath of toAnalyze) {
        console.log(`Analyzing: ${metaPath}`);

        try {
            const analysis = await analyzeFailureFile(metaPath);
            if (!analysis) continue;

            const outputFile = metaPath.replace("meta.json", "ai.txt");
            fs.writeFileSync(outputFile, analysis.content);
            console.log(`Saved AI analysis: ${path.basename(outputFile)}`);

            entries.push({
                metaPath,
                relativePath: path.relative(runDir, outputFile),
                content: analysis.content,
                usage: analysis.usage,
                estimatedCostUsd: analysis.estimatedCostUsd,
            });
        } catch (error) {
            console.error(`AI analysis failed for ${metaPath}:`, error);
        }
    }

    if (entries.length === 0) {
        return { analyzed: 0, summaryPath: null };
    }

    const summaryInput = {
        provider: provider?.name,
        model: provider?.model,
        entries,
    };

    const summaryPath = path.join(runDir, "ai-summary.md");
    fs.writeFileSync(summaryPath, formatAiSummaryMarkdown(summaryInput));
    console.log(`\n${formatCostRollupLine(summaryInput)}`);
    console.log(`Saved AI summary: ${summaryPath}`);

    return { analyzed: entries.length, summaryPath };
}

export default async function globalTeardown() {
    if (process.env.AI_ANALYSIS !== "true") return;

    const runDir = fs.readFileSync(
        path.join("artifacts", ".current-run"),
        "utf-8"
    );
    if (!runDir || !fs.existsSync(runDir)) return;

    await runAiTeardown(runDir);
}

import fs from "fs";
import path from "path";
import { analyzeFailureFile } from "../ai/failureAnalyzer";
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

export default async function globalTeardown() {
    if (process.env.AI_ANALYSIS !== "true") return;

    const runDir = fs.readFileSync(
        path.join("artifacts", ".current-run"),
        "utf-8"
    );
    if (!runDir || !fs.existsSync(runDir)) return;

    const metaFiles = findMetaFiles(runDir);
    if (metaFiles.length === 0) return;

    const toAnalyze = selectMetaFilesForAnalysis(metaFiles, readMeta);

    for (const metaPath of toAnalyze) {
        console.log(`Analyzing: ${metaPath}`);

        try {
            const analysis = await analyzeFailureFile(metaPath);

            if (!analysis) continue;

            const outputFile = metaPath.replace("meta.json", "ai.txt");

            fs.writeFileSync(outputFile, analysis);

            console.log(`Saved AI analysis: ${path.basename(outputFile)}\n`);
        } catch (error) {
            console.error(`AI analysis failed for ${metaPath}:`, error);
        }
    }
}

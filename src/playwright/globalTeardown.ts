import fs from "fs";
import path from "path";
import { analyzeFailureFile } from "../ai/failureAnalyzer";

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

export default async function globalTeardown() {
    if (process.env.AI_ANALYSIS !== "true") return;

    const runDir = fs.readFileSync(
        path.join("artifacts", ".current-run"),
        "utf-8"
    );
    if (!runDir || !fs.existsSync(runDir)) return;

    const metaFiles = findMetaFiles(runDir);

    if (metaFiles.length === 0) return;


    for (const metaPath of metaFiles) {
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

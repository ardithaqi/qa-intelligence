import fs from "fs";
import path from "path";
import { createAiProvider } from "./getProvider";
import { buildFailureAnalysisPrompt } from "./prompt";

function findLatestMetaFile(root = "artifacts"): string | null {
    if (!fs.existsSync(root)) return null;

    let latestPath: string | null = null;
    let latestMtime = -1;

    function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }

            if (entry.name !== "meta.json") continue;

            const stats = fs.statSync(fullPath);
            if (stats.mtimeMs > latestMtime) {
                latestMtime = stats.mtimeMs;
                latestPath = fullPath;
            }
        }
    }

    walk(root);
    return latestPath;
}

export async function analyzeFailureFile(jsonFilePath: string): Promise<string | null> {
    const provider = createAiProvider();
    if (!provider) return null;

    const htmlPath = jsonFilePath.replace(".json", ".html");

    const meta = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
    const html = fs.existsSync(htmlPath)
        ? fs.readFileSync(htmlPath, "utf-8")
        : "";

    const prompt = buildFailureAnalysisPrompt({
        meta,
        errorMessage: String(meta.errorMessage ?? ""),
        html,
    });

    console.log(`Using AI provider: ${provider.name} (${provider.model})`);

    const result = await provider.analyze(prompt);
    return result?.content ?? null;
}

export async function analyzeLatestFailure(): Promise<string | null> {
    const latestMetaFile = findLatestMetaFile();

    if (!latestMetaFile) {
        console.log("No failure metadata found in artifacts.");
        return null;
    }

    console.log(`Analyzing latest failure: ${latestMetaFile}`);
    return analyzeFailureFile(latestMetaFile);
}

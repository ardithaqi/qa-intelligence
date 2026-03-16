#!/usr/bin/env node
import { analyzeLatestFailure } from "../lib/failureAnalyzer";
import fs from "fs";
import path from "path";

async function main() {
    console.log("Running AI failure analysis per test...");

    const artifactsRoot = "artifacts";

    if (!fs.existsSync(artifactsRoot)) {
        console.log("No artifacts directory found.");
        return;
    }

    const result = await analyzeLatestFailure();

    if (!result) {
        console.log("No AI analysis generated.");
        return;
    }

    const aiPath = path.join(artifactsRoot, "ai.txt");
    fs.writeFileSync(aiPath, result);

    console.log("Saved AI analysis:", aiPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
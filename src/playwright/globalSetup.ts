import fs from "fs";
import path from "path";

export default async function globalSetup() {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const runDir = path.join("artifacts", runId);

    fs.mkdirSync(runDir, { recursive: true });

    fs.writeFileSync(
        path.join("artifacts", ".current-run"),
        runDir
    );
}
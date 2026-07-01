#!/usr/bin/env node
import { execSync } from "child_process";

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return process.argv[idx + 1];
}

async function main() {
    const subcommand = process.argv[2];

    if (subcommand === "init") {
        const { main: runInit } = await import("./init");
        await runInit();
        return;
    }

    const baseline = getArg("baseline") ?? "baseline-artifacts";
    const current = getArg("current") ?? "artifacts";
    const repo = getArg("repo");
    const pr = getArg("pr");
    const token = getArg("token");

    console.log("Running failure diff...");

    execSync(`node ${__dirname}/diff.js --baseline ${baseline} --current ${current} --out failure-diff.json`, {
        stdio: "inherit"
    });

    if (repo && pr && token) {
        console.log("Posting PR comment...");

        execSync(`node ${__dirname}/postComment.js --diff failure-diff.json --repo ${repo} --pr ${pr} --token ${token}`, {
            stdio: "inherit"
        });
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

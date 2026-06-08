#!/usr/bin/env node
import fs from "fs";
import { formatDiffComment, hasFailureChanges } from "../lib/format";
import { DiffResult } from "../lib/types";
import { Octokit } from "@octokit/rest";

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return process.argv[idx + 1];
}

async function main() {
    const diffPath = getArg("diff");
    const repoArg = getArg("repo");
    const prArg = getArg("pr");
    const token = getArg("token");

    if (!diffPath || !repoArg || !prArg || !token) {
        console.error(
            "Usage: qa-ci-comment --diff <file> --repo <owner/repo> --pr <number> --token <token>"
        );
        process.exit(1);
    }

    const [owner, repo] = repoArg.split("/");
    const issue_number = Number(prArg);

    const raw = fs.readFileSync(diffPath, "utf8");
    const diff = JSON.parse(raw) as DiffResult;

    if (!hasFailureChanges(diff)) {
        console.log("No failure changes. Skipping comment.");
        return;
    }

    const body = formatDiffComment(diff);

    const octokit = new Octokit({ auth: token });

    // Find existing comment to update
    const { data: comments } = await octokit.issues.listComments({
        owner,
        repo,
        issue_number,
        per_page: 100,
    });

    const existing = comments.find(
        (c) =>
            c.user?.type === "Bot" &&
            typeof c.body === "string" &&
            c.body.startsWith("## AI Failure Diff Summary")
    );

    if (existing) {
        await octokit.issues.updateComment({
            owner,
            repo,
            comment_id: existing.id,
            body,
        });
        console.log("Updated existing AI diff comment.");
    } else {
        await octokit.issues.createComment({
            owner,
            repo,
            issue_number,
            body,
        });
        console.log("Created new AI diff comment.");
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
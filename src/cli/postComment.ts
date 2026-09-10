#!/usr/bin/env node
import fs from "fs";
import {
    formatClearDiffComment,
    formatDiffComment,
    hasFailureChanges,
} from "../lib/format";
import { DiffResult } from "../lib/types";
import { Octokit } from "@octokit/rest";

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return process.argv[idx + 1];
}

const COMMENT_HEADER = "## AI Failure Diff Summary";

async function findExistingComment(
    octokit: Octokit,
    owner: string,
    repo: string,
    issue_number: number
) {
    const { data: comments } = await octokit.issues.listComments({
        owner,
        repo,
        issue_number,
        per_page: 100,
    });

    return comments.find(
        (c) =>
            c.user?.type === "Bot" &&
            typeof c.body === "string" &&
            c.body.startsWith(COMMENT_HEADER)
    );
}

async function upsertComment(
    octokit: Octokit,
    owner: string,
    repo: string,
    issue_number: number,
    existing: { id: number } | undefined,
    body: string
) {
    if (existing) {
        await octokit.issues.updateComment({
            owner,
            repo,
            comment_id: existing.id,
            body,
        });
        console.log("Updated existing AI diff comment.");
        return;
    }

    await octokit.issues.createComment({
        owner,
        repo,
        issue_number,
        body,
    });
    console.log("Created new AI diff comment.");
}

async function main() {
    const diffPath = getArg("diff");
    const repoArg = getArg("repo");
    const prArg = getArg("pr");
    const token = getArg("token");

    if (!diffPath || !repoArg || !prArg || !token) {
        console.error(
            "Usage: qa-intelligence-comment --diff <file> --repo <owner/repo> --pr <number> --token <token>"
        );
        process.exit(1);
    }

    const [owner, repo] = repoArg.split("/");
    const issue_number = Number(prArg);

    const raw = fs.readFileSync(diffPath, "utf8");
    const diff = JSON.parse(raw) as DiffResult;

    const octokit = new Octokit({ auth: token });
    const existing = await findExistingComment(
        octokit,
        owner,
        repo,
        issue_number
    );

    if (!hasFailureChanges(diff)) {
        if (!existing) {
            console.log("No failure changes. Skipping comment.");
            return;
        }

        await upsertComment(
            octokit,
            owner,
            repo,
            issue_number,
            existing,
            formatClearDiffComment()
        );
        console.log("Cleared AI diff comment — all tests passed.");
        return;
    }

    await upsertComment(
        octokit,
        owner,
        repo,
        issue_number,
        existing,
        formatDiffComment(diff)
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

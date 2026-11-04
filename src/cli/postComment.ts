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

/** Bot comments starting with any of these are updated in place (old + new branding). */
export const COMMENT_HEADERS = ["## AI Release Guardian", "## AI Failure Diff Summary"];

async function findExistingComment(
    octokit: Octokit,
    owner: string,
    repo: string,
    issue_number: number
) {
    const comments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number,
        per_page: 100,
    });

    return comments.find(
        (c) =>
            c.user?.type === "Bot" &&
            typeof c.body === "string" &&
            COMMENT_HEADERS.some((h) => c.body!.startsWith(h))
    );
}

export interface PrTarget {
    repo: string;
    pr: number;
    token: string;
}

/**
 * Create or update the single bot summary comment on a PR.
 * `body: null` means "nothing to report": updates an existing comment with
 * `clearBody` if given, otherwise leaves the PR untouched.
 */
export async function upsertPrComment(
    target: PrTarget,
    body: string | null,
    clearBody?: string
): Promise<"created" | "updated" | "skipped"> {
    const [owner, repo] = target.repo.split("/");
    const octokit = new Octokit({ auth: target.token });
    const existing = await findExistingComment(octokit, owner, repo, target.pr);

    const text = body ?? (existing ? clearBody : undefined);
    if (!text) return "skipped";

    if (existing) {
        await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body: text });
        return "updated";
    }

    await octokit.issues.createComment({ owner, repo, issue_number: target.pr, body: text });
    return "created";
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

    const diff = JSON.parse(fs.readFileSync(diffPath, "utf8")) as DiffResult;
    const target = { repo: repoArg, pr: Number(prArg), token };

    const result = await upsertPrComment(
        target,
        hasFailureChanges(diff) ? formatDiffComment(diff) : null,
        formatClearDiffComment()
    );

    console.log(
        result === "skipped"
            ? "No failure changes. Skipping comment."
            : `${result === "created" ? "Created" : "Updated"} PR summary comment.`
    );
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

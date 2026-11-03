#!/usr/bin/env node
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import { createAiProvider } from "../ai/getProvider";
import type { AiProvider } from "../ai/types";
import { explainRootCauses, filesForAi, groupsForAi } from "../guardian/aiRootCause";
import { analyzeRelease, type AnalyzeReleaseOptions } from "../guardian/analyzeRelease";
import { loadGuardianConfig, DEFAULT_CONFIG_FILE } from "../guardian/config";
import { formatReleaseComment, type CommentOptions } from "../guardian/format";
import { collectChanges, collectPatches } from "../guardian/gitContext";
import { readRunSummary } from "../guardian/runSummary";
import type { ReleaseReport } from "../guardian/types";
import { computeDiff } from "../lib/computeDiff";
import { loadHistory } from "../lib/history";
import type { DiffResult } from "../lib/types";

const HELP = `AI Release Guardian

Usage:
  ai-release-guardian analyze [options]   Classify failures, score risk, decide (default)
  ai-release-guardian comment [options]   Post/update the PR summary comment
  ai-release-guardian init [--force]      Scaffold playwright/ + CI workflow

analyze options:
  --diff <file>        Failure diff to read (default failure-diff.json). Computed from
                       --baseline/--current when the file doesn't exist.
  --baseline <dir>     Base-branch artifacts (default baseline-artifacts)
  --current <dir>      This run's artifacts (default artifacts)
  --base <ref>         Git base ref/sha for changed-file attribution
                       (default $RELEASE_GUARDIAN_BASE, or origin/$GITHUB_BASE_REF)
  --head <ref>         Git head ref (default HEAD)
  --history <file>     Failure history cache (default .cache/failure-history.json)
  --config <file>      Area config (default ${DEFAULT_CONFIG_FILE})
  --out <file>         JSON report (default release-report.json)
  --markdown <file>    Markdown summary (default release-guardian.md)
  --fail-on <policy>   review | block | never (default $RELEASE_GUARDIAN_FAIL_ON or review)
  --ai <mode>          auto | on | off (default $RELEASE_GUARDIAN_AI or auto). auto runs one
                       root-cause call (failing tests + PR diff) when an AI key is set.

comment options:
  --report <file>      Report from analyze (default release-report.json)
  --repo <owner/repo>  --pr <number>  --token <token> (default $GITHUB_TOKEN)

Exit codes: 0 allowed · 1 gated by --fail-on · 2 usage or I/O error`;

const FAIL_ON = ["review", "block", "never"] as const;
type FailOn = (typeof FAIL_ON)[number];

class UsageError extends Error {}

interface SavedReport {
    report: ReleaseReport;
    diff: DiffResult;
}

function defaultBase(env: NodeJS.ProcessEnv): string | undefined {
    if (env.RELEASE_GUARDIAN_BASE) return env.RELEASE_GUARDIAN_BASE;
    if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
    return undefined;
}

/** Clickable file links + CI run link when running in GitHub Actions. */
export function commentOptionsFromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): CommentOptions {
    const server = env.GITHUB_SERVER_URL || "https://github.com";
    const repo = env.GITHUB_REPOSITORY;
    const sha = env.RELEASE_GUARDIAN_HEAD_SHA || env.GITHUB_SHA;
    if (!repo || !sha) return {};

    let testPathPrefix = "";
    try {
        // Tests live under e.g. playwright/ - links need the path from the repo root.
        testPathPrefix = execFileSync("git", ["rev-parse", "--show-prefix"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { }

    return {
        commit: sha,
        links: { server, repo, sha, testPathPrefix },
        ...(env.GITHUB_RUN_ID ? { runUrl: `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` } : {}),
    };
}

export function exitCodeFor(decision: ReleaseReport["decision"], failOn: FailOn): number {
    if (failOn === "never") return 0;
    if (decision === "BLOCK") return 1;
    return failOn === "review" && decision === "REVIEW REQUIRED" ? 1 : 0;
}

const AI_MODES = ["auto", "on", "off"] as const;

function hasAiKey(env: NodeJS.ProcessEnv): boolean {
    return [env.OPENAI_API_KEY, env.ANTHROPIC_API_KEY, env.AI_API_KEY].some((k) => k?.trim());
}

export async function runAnalyze(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
    deps: { provider?: AiProvider | null } = {}
): Promise<number> {
    const { values } = parseArgs({
        args,
        options: {
            diff: { type: "string", default: "failure-diff.json" },
            baseline: { type: "string", default: "baseline-artifacts" },
            current: { type: "string", default: "artifacts" },
            base: { type: "string" },
            head: { type: "string", default: "HEAD" },
            history: { type: "string", default: ".cache/failure-history.json" },
            config: { type: "string", default: DEFAULT_CONFIG_FILE },
            out: { type: "string", default: "release-report.json" },
            markdown: { type: "string", default: "release-guardian.md" },
            "fail-on": { type: "string", default: env.RELEASE_GUARDIAN_FAIL_ON || "review" },
            ai: { type: "string", default: env.RELEASE_GUARDIAN_AI || "auto" },
        },
    });
    const aiMode = values.ai as (typeof AI_MODES)[number];
    if (!AI_MODES.includes(aiMode)) throw new UsageError(`--ai must be one of: ${AI_MODES.join(", ")}`);

    const failOn = values["fail-on"] as FailOn;
    if (!FAIL_ON.includes(failOn)) throw new UsageError(`--fail-on must be one of: ${FAIL_ON.join(", ")}`);
    if (path.resolve(values.out) === path.resolve(values.markdown)) {
        throw new UsageError("--out and --markdown must be different files");
    }

    const diff: DiffResult = fs.existsSync(values.diff)
        ? JSON.parse(fs.readFileSync(values.diff, "utf8"))
        : computeDiff(values.baseline, values.current);

    const { config, warning: configWarning } = loadGuardianConfig(values.config);
    const base = values.base ?? defaultBase(env);
    const changes = collectChanges(base, values.head);
    const options: AnalyzeReleaseOptions = {
        changes,
        runSummary: readRunSummary(values.current),
        history: fs.existsSync(values.history) ? loadHistory(values.history) : undefined,
        config,
    };
    let report = analyzeRelease(diff, options);

    // Optional AI step: one call with the failing tests + the PR diff. Rules still decide.
    const aiWanted = aiMode === "on" || (aiMode === "auto" && hasAiKey(env));
    const provider = aiWanted ? (deps.provider !== undefined ? deps.provider : createAiProvider(env)) : null;
    let aiWarning: string | undefined;
    if (provider && groupsForAi(report).length > 0 && changes.files.length > 0) {
        try {
            const patches = collectPatches(base, filesForAi(report, changes.files), values.head);
            const { causes, overview, costUsd } = await explainRootCauses(report, changes.files, patches, provider);
            if (Object.keys(causes).length > 0 || overview) {
                report = analyzeRelease(diff, {
                    ...options,
                    aiCauses: causes,
                    ...(overview ? { aiOverview: overview } : {}),
                    ai: { model: provider.model, provider: provider.name, ...(costUsd != null ? { costUsd } : {}) },
                });
                console.log(`AI root cause: ${provider.model}${costUsd != null ? `, ~$${costUsd.toFixed(4)}` : ""}`);
            }
        } catch (error) {
            aiWarning = `AI root cause skipped: ${(error as Error).message.split("\n")[0].slice(0, 160)}`;
        }
    } else if (aiMode === "on" && !provider) {
        aiWarning = "AI root cause requested (--ai on) but no AI provider is configured.";
    }
    if (aiWarning) report.warnings.unshift(aiWarning);
    if (configWarning) report.warnings.unshift(configWarning);

    const markdown = formatReleaseComment(report, diff, commentOptionsFromEnv(env));
    const saved: SavedReport = { report, diff };
    fs.writeFileSync(values.out, JSON.stringify(saved, null, 2) + "\n");
    fs.writeFileSync(values.markdown, markdown);

    console.log(markdown);
    console.log(`Wrote ${values.out} and ${values.markdown}`);

    const code = exitCodeFor(report.decision, failOn);
    if (code !== 0) console.error(`AI Release Guardian: ${report.decision} (--fail-on ${failOn}).`);
    return code;
}

export async function runComment(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
    const { values } = parseArgs({
        args,
        options: {
            report: { type: "string", default: "release-report.json" },
            repo: { type: "string" },
            pr: { type: "string" },
            token: { type: "string", default: env.GITHUB_TOKEN },
        },
    });

    if (!values.repo || !values.pr || !values.token) {
        throw new UsageError("comment requires --repo <owner/repo>, --pr <number> and --token (or $GITHUB_TOKEN)");
    }

    const { report, diff } = JSON.parse(fs.readFileSync(values.report, "utf8")) as SavedReport;
    const body = formatReleaseComment(report, diff, commentOptionsFromEnv(env));
    const nothingToReport = report.failureCount === 0 && report.fixedCount === 0;

    // Imported lazily so `analyze` doesn't load Octokit.
    const { upsertPrComment } = await import("./postComment");
    const result = await upsertPrComment(
        { repo: values.repo, pr: Number(values.pr), token: values.token },
        nothingToReport ? null : body,
        body
    );
    console.log(result === "skipped" ? "Nothing to report; no comment posted." : `PR comment ${result}.`);
    return 0;
}

export async function runGuardian(argv: string[] = process.argv.slice(2)): Promise<number> {
    const [first, ...rest] = argv;

    if (first === "--help" || first === "-h" || first === "help") {
        console.log(HELP);
        return 0;
    }
    if (first === "init") {
        const { main } = await import("./init");
        await main();
        return 0;
    }
    if (first === "comment") return runComment(rest);
    if (first === "analyze") return await runAnalyze(rest);
    if (first === undefined || first.startsWith("--")) return await runAnalyze(argv);

    throw new UsageError(`Unknown command "${first}". Run ai-release-guardian --help.`);
}

if (require.main === module) {
    runGuardian()
        .then((code) => {
            process.exitCode = code;
        })
        .catch((error) => {
            console.error(`AI Release Guardian: ${(error as Error).message}`);
            if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
                console.error("Run ai-release-guardian --help for usage.");
            }
            process.exitCode = 2;
        });
}

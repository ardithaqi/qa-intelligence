import type { AiProvider } from "../ai/types";
import { stripAnsi } from "../lib/failureSignals";
import type { Failure } from "../lib/types";
import { IGNORED_CHANGE, TEST_FILE } from "./attribution";
import type { AiCause, ChangedFile, FailureGroup, ReleaseReport } from "./types";

/**
 * PR-level AI root cause: one call that sees the failing tests *and* the PR
 * diff, and says which change broke what. The rules still decide; this only
 * supplies attribution (capped) and a plain-English explanation.
 */

const ACTIONABLE = new Set(["regression", "unknown", "test_issue"]);
export const MAX_AI_GROUPS = 10;
export const MAX_AI_FILES = 12;
/** AI-sourced attribution never claims more than this. */
export const AI_ATTRIBUTION_CAP = 85;
/** Below this the AI's file pick is ignored (its explanation is still shown). */
export const AI_MIN_CONFIDENCE = 50;

/** Stable id for a failure across re-analysis (group ids are positional). */
export function failureRef(f: Failure): string {
    return `${f.file}:${f.line}:${f.failure_type}`;
}

/** Groups worth explaining: product/test failures introduced by this PR. */
export function groupsForAi(report: ReleaseReport): FailureGroup[] {
    return report.groups.filter((g) => ACTIONABLE.has(g.category)).slice(0, MAX_AI_GROUPS);
}

/** Changed files worth showing the AI: attributed ones first, then source, then the failing tests. */
export function filesForAi(report: ReleaseReport, changes: ChangedFile[]): string[] {
    const groups = groupsForAi(report);
    const attributed = new Set(groups.flatMap((g) => g.failures.map((f) => f.attribution?.path).filter(Boolean) as string[]));
    const failingTests = new Set(groups.flatMap((g) => g.failures.map((f) => f.failure.file)));
    const isFailingTest = (p: string) => [...failingTests].some((t) => p === t || p.endsWith(`/${t}`));

    const candidates = changes.map((c) => c.path).filter((p) => !IGNORED_CHANGE.test(p));
    const rank = (p: string) => (attributed.has(p) ? 0 : !TEST_FILE.test(p) ? 1 : isFailingTest(p) ? 2 : 3);
    return candidates
        .filter((p) => rank(p) < 3)
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, MAX_AI_FILES);
}

function errorExcerpt(f: Failure): string {
    const lines = stripAnsi(f.errorMessage ?? "").split("\n").filter((l) => l.trim());
    const callLog = lines.findIndex((l) => /^\s*Call log:/.test(l));
    return (callLog >= 0 ? lines.slice(0, callLog) : lines).slice(0, 6).join("\n");
}

export function buildRootCausePrompt(report: ReleaseReport, patches: Record<string, string>): string {
    const problems = groupsForAi(report).map((g) => ({
        id: g.id,
        tests: g.failures.map((f) => `${f.failure.file}:${f.failure.line}${f.failure.title ? ` "${f.failure.title}"` : ""}`),
        error: errorExcerpt(g.failures[0].failure),
    }));
    const diff = Object.entries(patches).map(([file, patch]) => `### ${file}\n${patch}`).join("\n\n");

    return `You are reviewing a pull request whose end-to-end tests failed. For each problem, decide which
changed file in the diff most likely caused it, using ONLY the errors and the diff below.

Rules:
- "file" must be one of the changed files listed in the diff, exactly as written, or null.
- Use null when the diff does not explain the failure. Do not guess.
- "summary": what changed and why it makes the test fail, max 2 short sentences, concrete (name the value or line).
- "fix": one short sentence, or null.
- "confidence": 0-100, how strongly the diff supports the link. Name-only resemblance is not evidence.
- No markdown, no prose outside the JSON. Do not use the em dash character.

Problems:
${JSON.stringify(problems, null, 2)}

Diff of changed files:
${diff || "(no diff available)"}

Respond with only a JSON array:
[{"id": "G1", "file": "path/or/null", "summary": "...", "fix": "...", "confidence": 0}]`;
}

/** First top-level JSON array in the text, tolerant of fences or chatter around it. */
function extractArray(text: string): unknown[] | null {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

const clean = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.replace(/\s*\u2014\s*/g, ", ").trim().slice(0, max) : undefined;

/**
 * Validates the AI answer: unknown group ids and files that are not in the
 * diff are dropped, confidence is clamped. Returns causes keyed by failureRef.
 */
export function parseRootCauseResponse(
    text: string,
    report: ReleaseReport,
    changedPaths: string[]
): Record<string, AiCause> {
    const items = extractArray(text) ?? [];
    const groups = new Map(groupsForAi(report).map((g) => [g.id, g]));
    const allowed = new Set(changedPaths);
    const out: Record<string, AiCause> = {};

    for (const raw of items) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const group = typeof item.id === "string" ? groups.get(item.id) : undefined;
        const summary = clean(item.summary, 300);
        if (!group || !summary) continue;

        const file = typeof item.file === "string" && allowed.has(item.file) ? item.file : null;
        const confidence = Math.max(0, Math.min(100, Math.round(Number(item.confidence) || 0)));
        const fix = clean(item.fix, 200);
        const cause: AiCause = { path: file, summary, confidence, ...(fix ? { fix } : {}) };

        for (const f of group.failures) out[failureRef(f.failure)] = cause;
    }
    return out;
}

export async function explainRootCauses(
    report: ReleaseReport,
    changes: ChangedFile[],
    patches: Record<string, string>,
    provider: AiProvider
): Promise<{ causes: Record<string, AiCause>; costUsd?: number }> {
    if (groupsForAi(report).length === 0 || Object.keys(patches).length === 0) return { causes: {} };
    const result = await provider.analyze(buildRootCausePrompt(report, patches));
    if (!result?.content) return { causes: {} };
    return {
        causes: parseRootCauseResponse(result.content, report, changes.map((c) => c.path)),
        ...(result.estimatedCostUsd != null ? { costUsd: result.estimatedCostUsd } : {}),
    };
}

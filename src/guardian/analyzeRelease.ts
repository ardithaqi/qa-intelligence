import { computeFlakyWatchlist } from "../lib/flakyWatchlist";
import { normalizeTestPath } from "../lib/failureIdentity";
import type { DiffResult, Failure, FlakyWatchlistEntry, History } from "../lib/types";
import { AI_ATTRIBUTION_CAP, AI_MIN_CONFIDENCE, failureRef } from "./aiRootCause";
import { attributeFailure, detectArea, isSameTestFile } from "./attribution";
import { classifyFailure } from "./classify";
import { DEFAULT_CONFIG } from "./config";
import { decideRelease } from "./decision";
import { groupFailures } from "./group";
import { scoreRisk } from "./risk";
import type {
    AiCause,
    Attribution,
    CategoryCounts,
    ChangedFile,
    ChangeContext,
    ClassifiedFailure,
    FailureLifecycle,
    GuardianConfig,
    ReleaseReport,
    RunSummary,
} from "./types";

export interface AnalyzeReleaseOptions {
    /** Files changed in the PR (from collectChanges). Omit to skip attribution. */
    changes?: ChangeContext;
    /** Totals from the Playwright reporter's run-summary.json. */
    runSummary?: RunSummary;
    /** Failure history cache; used for intermittency evidence. */
    history?: History;
    config?: GuardianConfig;
    /** PR-level AI root causes keyed by failureRef (from explainRootCauses). */
    aiCauses?: Record<string, AiCause>;
    /** Shown in the report when the AI step ran. */
    ai?: ReleaseReport["ai"];
    /** AI overview of the whole run (from explainRootCauses). */
    aiOverview?: string;
}

/**
 * The AI's file pick becomes attribution only when confident, capped at
 * AI_ATTRIBUTION_CAP. If it agrees with the naming heuristic, the two
 * corroborate each other (+10, max 90).
 */
function mergeAttribution(
    failure: Failure,
    heuristic: Attribution | undefined,
    cause: AiCause | undefined,
    changes: ChangedFile[]
): Attribution | undefined {
    if (!cause?.path || cause.confidence < AI_MIN_CONFIDENCE) return heuristic;
    const change = changes.find((c) => c.path === cause.path);
    const aiConfidence = Math.min(AI_ATTRIBUTION_CAP, cause.confidence);
    const agrees = heuristic?.path === cause.path;
    return {
        path: cause.path,
        kind: isSameTestFile(cause.path, failure.file) ? "test_file" : "ai",
        ...(change?.commit ? { commit: change.commit } : {}),
        ...(change?.commitSubject ? { commitSubject: change.commitSubject } : {}),
        confidence: agrees ? Math.min(90, Math.max(aiConfidence, heuristic!.confidence) + 10) : aiConfidence,
        evidence: agrees
            ? `AI read the diff and agrees: ${cause.summary}`
            : `AI read the diff: ${cause.summary}`,
    };
}

const ACTIONABLE = new Set(["regression", "unknown", "test_issue"]);

function historyIndex(history: History | undefined): Map<string, FlakyWatchlistEntry> {
    const index = new Map<string, FlakyWatchlistEntry>();
    if (!history) return index;
    for (const entry of computeFlakyWatchlist(history)) index.set(entry.testFile, entry);
    return index;
}

/**
 * Turns a failure diff into a release report: classification, grouping,
 * attribution, risk score and decision. Pure and deterministic - same input,
 * same output. Works without AI; AI-derived fields are just extra evidence.
 */
export function analyzeRelease(diff: DiffResult, options: AnalyzeReleaseOptions = {}): ReleaseReport {
    const config = options.config ?? DEFAULT_CONFIG;
    const changes = options.changes?.files ?? [];
    const intermittent = historyIndex(options.history);
    const critical = new Set(config.criticalAreas);

    const classify = (failure: Failure, lifecycle: FailureLifecycle): ClassifiedFailure => {
        const aiCause = lifecycle === "new" ? options.aiCauses?.[failureRef(failure)] : undefined;
        const heuristic = lifecycle === "new" ? attributeFailure(failure, changes, config) : undefined;
        const attribution = mergeAttribution(failure, heuristic, aiCause, changes);
        const area = detectArea(failure, config);
        const classification = classifyFailure({
            failure,
            lifecycle,
            attribution,
            history: intermittent.get(normalizeTestPath(failure.file)),
        });
        return {
            failure,
            lifecycle,
            classification,
            area,
            critical: critical.has(area),
            ...(attribution ? { attribution } : {}),
            ...(aiCause ? { aiCause } : {}),
        };
    };

    const fresh = (diff.newFailures ?? []).map((f) => classify(f, "new"));
    const existing = (diff.unchangedFailures ?? []).map((f) => classify(f, "existing"));
    const failures = [...fresh, ...existing];

    const groups = groupFailures(fresh);
    const risk = scoreRisk(failures, groups);
    const testsAnalyzed = options.runSummary?.total;
    const { decision, reason } = decideRelease({ failures, groups, risk, testsAnalyzed });

    const counts: CategoryCounts = { regression: 0, flaky: 0, infrastructure: 0, test_issue: 0, unknown: 0 };
    for (const f of fresh) counts[f.classification.category]++;

    const actionable = fresh.filter((f) => ACTIONABLE.has(f.classification.category));
    const affectedAreas = [...new Set(actionable.map((f) => f.area))];
    const primaryGroup = groups.find((g) => ACTIONABLE.has(g.category));

    const warnings: string[] = [];
    if (options.changes?.warning) warnings.push(options.changes.warning);
    const heuristic = failures.filter((f) => f.failure.source === "heuristic").length;
    if (heuristic > 0) {
        warnings.push(`${heuristic} failure(s) classified from error output only (no AI analysis available).`);
    }

    return {
        schemaVersion: 1,
        decision,
        decisionReason: reason,
        risk,
        ...(testsAnalyzed != null ? { testsAnalyzed } : {}),
        failureCount: failures.length,
        counts,
        preExistingCount: existing.length,
        fixedCount: diff.fixedFailures?.length ?? 0,
        affectedAreas,
        ...(primaryGroup ? { primaryGroup } : {}),
        groups,
        failures,
        warnings,
        ...(options.ai ? { ai: options.ai } : {}),
        ...(options.aiOverview ? { aiOverview: options.aiOverview } : {}),
    };
}

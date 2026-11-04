import type { Failure } from "../lib/types";

export type FailureCategory =
    | "regression"
    | "flaky"
    | "infrastructure"
    | "test_issue"
    | "unknown";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ReleaseDecision = "SAFE TO MERGE" | "REVIEW REQUIRED" | "BLOCK";

/** "new" = not failing on the base branch; "existing" = already failing there. */
export type FailureLifecycle = "new" | "existing";

export interface ChangedFile {
    path: string;
    /** Latest commit in the PR range that touched this file. */
    commit?: string;
    commitSubject?: string;
}

export interface ChangeContext {
    files: ChangedFile[];
    /** Set when git data could not be collected; attribution is then skipped. */
    warning?: string;
}

export interface Attribution {
    path: string;
    /** How the link was found: the failing test file itself, the path in error output, naming overlap, or AI reading the diff. */
    kind: "test_file" | "error_output" | "naming" | "ai";
    commit?: string;
    commitSubject?: string;
    /** 0–100. Heuristic; never treated as proof. */
    confidence: number;
    evidence: string;
}

export interface Classification {
    category: FailureCategory;
    /** 0–100 */
    confidence: number;
    reasons: string[];
}

/** Root cause from the AI reading the failing tests together with the PR diff. */
export interface AiCause {
    /** Changed file the AI blames, or null when it can't tell from the diff. */
    path: string | null;
    /** What changed and why it breaks the test, one or two sentences. */
    summary: string;
    /** Suggested fix, one sentence. */
    fix?: string;
    /** 0–100 as reported by the AI; capped when used as attribution. */
    confidence: number;
}

export interface ClassifiedFailure {
    failure: Failure;
    /** Set when the PR-level AI root-cause step ran and covered this failure. */
    aiCause?: AiCause;
    lifecycle: FailureLifecycle;
    classification: Classification;
    area: string;
    critical: boolean;
    attribution?: Attribution;
}

export interface FailureGroup {
    id: string;
    category: FailureCategory;
    /** Changed file path, or a normalized error signature when no file is implicated. */
    rootCause: string;
    rootCauseKind: "changed_file" | "error_signature" | "single";
    commit?: string;
    /** 0–100 */
    confidence: number;
    reason: string;
    areas: string[];
    failures: ClassifiedFailure[];
}

export interface RunSummary {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    status?: string;
}

export interface RiskScore {
    score: number;
    level: RiskLevel;
    /** Each contribution that added to the score, in order. */
    reasons: string[];
}

export interface CategoryCounts {
    regression: number;
    flaky: number;
    infrastructure: number;
    test_issue: number;
    unknown: number;
}

export interface ReleaseReport {
    schemaVersion: 1;
    decision: ReleaseDecision;
    decisionReason: string;
    risk: RiskScore;
    testsAnalyzed?: number;
    /** Failures introduced or still present in this run (excludes fixed). */
    failureCount: number;
    /** Counts for new failures only - the ones this PR is accountable for. */
    counts: CategoryCounts;
    /** Failures also failing on the base branch that still fail after retries. */
    preExistingCount: number;
    /** Failures also on the base branch that passed on retry: flaky there too, not still failing. */
    preExistingFlakyCount?: number;
    fixedCount: number;
    affectedAreas: string[];
    primaryGroup?: FailureGroup;
    groups: FailureGroup[];
    failures: ClassifiedFailure[];
    warnings: string[];
    /** Present when the AI root-cause step ran. */
    ai?: { model: string; provider: string; costUsd?: number };
    /** AI's 2-3 sentence overview of the whole run, read before the problem list. */
    aiOverview?: string;
}

export interface GuardianConfig {
    /** Area name → keywords matched against test path, title and URL. */
    areas: Record<string, string[]>;
    /** Area names that weigh extra in risk scoring. */
    criticalAreas: string[];
}

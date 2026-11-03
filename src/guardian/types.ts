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
    /** How the link was found: the failing test file itself, the path in error output, or naming overlap. */
    kind: "test_file" | "error_output" | "naming";
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

export interface ClassifiedFailure {
    failure: Failure;
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
    /** Counts for new failures only — the ones this PR is accountable for. */
    counts: CategoryCounts;
    preExistingCount: number;
    fixedCount: number;
    affectedAreas: string[];
    primaryGroup?: FailureGroup;
    groups: FailureGroup[];
    failures: ClassifiedFailure[];
    warnings: string[];
}

export interface GuardianConfig {
    /** Area name → keywords matched against test path, title and URL. */
    areas: Record<string, string[]>;
    /** Area names that weigh extra in risk scoring. */
    criticalAreas: string[];
}

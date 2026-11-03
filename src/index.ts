/**
 * Programmatic API — use in custom CI scripts, GitLab/Jenkins jobs, Slack bots, etc.
 * CLIs (qa-intelligence-diff, -history, -comment) wrap these same functions.
 */

export { computeDiff } from "./lib/computeDiff";
export type { Failure as DiffFailure } from "./lib/computeDiff";

export {
    formatClearDiffComment,
    formatDiffComment,
    hasFailureChanges,
} from "./lib/format";

export {
    computeFlakyWatchlist,
    DEFAULT_MIN_FAIL_COUNT,
    DEFAULT_MIN_RUNS,
    filterWatchlistForCurrentDiff,
    testFileFromFailure,
    testFileFromFailureKey,
} from "./lib/flakyWatchlist";

export {
    appendHistoryRun,
    collectCurrentKeys,
    enrichDiffWithHistory,
    enrichFailures,
    failureKey,
    loadHistory,
    saveHistory,
    MAX_RUNS,
} from "./lib/history";
export type { EnrichedFailure, Failure as HistoryFailure } from "./lib/history";
export type { Failure } from "./lib/types";

export {
    failureDiffKey,
    normalizeTestPath,
    parseAttemptFromAiPath,
    parseLocationFromStack,
} from "./lib/failureIdentity";

export type {
    AiFailure,
    DiffResult,
    FailureKey,
    FailureType,
    FlakyWatchlistEntry,
    History,
    RunRecord,
    Severity,
} from "./lib/types";

// --- AI Release Guardian ---------------------------------------------------

export { analyzeRelease } from "./guardian/analyzeRelease";
export type { AnalyzeReleaseOptions } from "./guardian/analyzeRelease";
export { classifyFailure } from "./guardian/classify";
export type { ClassifyInput } from "./guardian/classify";
export { attributeFailure, detectArea } from "./guardian/attribution";
export { groupFailures } from "./guardian/group";
export { scoreRisk, riskLevel, RISK_WEIGHTS } from "./guardian/risk";
export { decideRelease, BLOCK_CONFIDENCE } from "./guardian/decision";
export { collectChanges } from "./guardian/gitContext";
export { readRunSummary, RUN_SUMMARY_FILENAME } from "./guardian/runSummary";
export { DEFAULT_CONFIG, loadGuardianConfig } from "./guardian/config";
export { formatReleaseComment, GUARDIAN_COMMENT_HEADER } from "./guardian/format";
export { formatDiffSections } from "./lib/format";
export { errorSignature, inferFailureType } from "./lib/failureSignals";
export type {
    Attribution,
    CategoryCounts,
    ChangeContext,
    ChangedFile,
    Classification,
    ClassifiedFailure,
    FailureCategory,
    FailureGroup,
    FailureLifecycle,
    GuardianConfig,
    ReleaseDecision,
    ReleaseReport,
    RiskLevel,
    RiskScore,
    RunSummary,
} from "./guardian/types";

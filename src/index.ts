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

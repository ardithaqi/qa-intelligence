/**
 * Programmatic API — use in custom CI scripts, GitLab/Jenkins jobs, Slack bots, etc.
 * CLIs (qa-intelligence-diff, -history, -comment) wrap these same functions.
 */

export { computeDiff } from "./lib/computeDiff";
export type { Failure as DiffFailure } from "./lib/computeDiff";

export { formatDiffComment, hasFailureChanges } from "./lib/format";

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
export type {
    EnrichedFailure,
    Failure as HistoryFailure,
    History,
    RunRecord,
} from "./lib/history";

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
    Severity,
} from "./lib/types";

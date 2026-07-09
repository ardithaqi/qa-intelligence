export type Severity = "low" | "medium" | "high";

export type FailureType =
    | "assertion_mismatch"
    | "selector_not_found"
    | "timeout"
    | "navigation_failure"
    | "environment_error"
    | "unknown";

export type AiFailure = {
    file: string;
    line: number;
    failure_type: FailureType | string;
    expected?: number | string;
    received?: number | string;
    is_flaky_suspected?: boolean;
    severity: Severity | string;
    confidence: number;
    first_seen?: string;
    occurrence_count?: number;
};

export type FailureKey = string;

export type FlakyWatchlistEntry = {
    testFile: string;
    failCount: number;
    totalRuns: number;
    failRate: number;
};

export type RunRecord = {
    sha: string;
    timestamp: string;
    failureKeys: string[];
};

export type History = {
    runs: RunRecord[];
};

export type DiffResult = {
    newFailures: AiFailure[];
    unchangedFailures: AiFailure[];
    fixedFailures: AiFailure[];
    blockingFailures?: AiFailure[];
    flakyWatchlist?: FlakyWatchlistEntry[];
};

export type Severity = "low" | "medium" | "high";

export type FailureType =
    | "assertion_mismatch"
    | "selector_not_found"
    | "timeout"
    | "navigation_failure"
    | "environment_error"
    | "unknown";

export type AiFailure = {
    file: string; // project-relative, e.g. tests/... (your prompt enforces this)
    line: number;
    failure_type: FailureType;
    expected?: number | string;
    received?: number | string;
    is_flaky_suspected: boolean;
    severity: Severity;
    confidence: number;
};

export type FailureKey = string;

export type DiffResult = {
    baselineCount: number;
    currentCount: number;
    newFailures: AiFailure[];
    fixedFailures: AiFailure[];
};
import { INFRASTRUCTURE_PATTERN, TEST_ISSUE_PATTERN, stripAnsi } from "../lib/failureSignals";
import type { Failure, FlakyWatchlistEntry } from "../lib/types";
import type { Attribution, Classification, FailureLifecycle } from "./types";

export interface ClassifyInput {
    failure: Failure;
    lifecycle: FailureLifecycle;
    attribution?: Attribution;
    /** Pass/fail flip stats for this test file from the history cache, if any. */
    history?: FlakyWatchlistEntry;
}

const DETERMINISTIC_TYPES = new Set(["assertion_mismatch", "selector_not_found", "navigation_failure"]);

const clamp = (n: number) => Math.max(5, Math.min(97, Math.round(n)));

function historyReason(h: FlakyWatchlistEntry): string {
    return `Intermittent in ${h.failCount} of the last ${h.totalRuns} CI runs.`;
}

function browserSuffix(f: Failure): string {
    return f.project ? ` on ${f.project}` : "";
}

/**
 * Deterministic, rule-based classification. Rules run in priority order and
 * every result carries the evidence that produced it. AI output is used only
 * as one input (failure_type, confidence) - never as the verdict itself.
 */
export function classifyFailure(input: ClassifyInput): Classification {
    const { failure, lifecycle, attribution, history } = input;
    const message = stripAnsi(failure.errorMessage ?? "");
    const attempts = (failure.retry ?? 0) + 1;
    const sourceAttribution = attribution?.kind !== "test_file" ? attribution : undefined;

    // 1. Passed on retry in this very run - the strongest flakiness evidence there is.
    if (failure.is_flaky_suspected) {
        const reasons = [`Failed, then passed on retry${browserSuffix(failure)}.`];
        let confidence = 88;
        if (history) {
            reasons.push(historyReason(history));
            confidence += 7;
        } else if ((failure.occurrence_count ?? 0) >= 3) {
            reasons.push(`Seen ${failure.occurrence_count} times in recent CI history.`);
            confidence += 4;
        }
        return { category: "flaky", confidence: clamp(confidence), reasons };
    }

    // 2. Environment / network / browser startup.
    if (INFRASTRUCTURE_PATTERN.test(message) || failure.failure_type === "environment_error") {
        const matched = INFRASTRUCTURE_PATTERN.test(message);
        return {
            category: "infrastructure",
            confidence: matched ? 85 : 65,
            reasons: [
                matched
                    ? `Error matches an environment/network signature${browserSuffix(failure)}: "${firstLine(message)}".`
                    : "AI analysis classified this as an environment error.",
            ],
        };
    }

    // 3. The test code itself is broken.
    if (TEST_ISSUE_PATTERN.test(message)) {
        return {
            category: "test_issue",
            confidence: 75,
            reasons: [`Error points at the test code, not the product: "${firstLine(message)}".`],
        };
    }
    if (
        lifecycle === "new" &&
        attribution &&
        !sourceAttribution &&
        failure.failure_type === "selector_not_found"
    ) {
        return {
            category: "test_issue",
            confidence: 55,
            reasons: [
                "The failing test file was edited in this PR and its locator no longer resolves.",
                "No related application change was found.",
            ],
        };
    }

    // 4. Already failing on the base branch - real or not, this PR did not introduce it.
    if (lifecycle === "existing") {
        if (history) {
            return {
                category: "flaky",
                confidence: 60,
                reasons: ["Also failing on the base branch.", historyReason(history)],
            };
        }
        return {
            category: DETERMINISTIC_TYPES.has(failure.failure_type) ? "regression" : "unknown",
            confidence: 60,
            reasons: ["Also failing on the base branch, so this PR did not introduce it."],
        };
    }

    // 5. New, deterministic failure.
    const reasons: string[] = ["New failure: not failing on the base branch."];
    if (attempts > 1) reasons.push(`Failed on all ${attempts} attempts${browserSuffix(failure)}.`);
    else reasons.push("Ran once (no retries), so flakiness can't be ruled out.");

    let confidence: number;
    if (DETERMINISTIC_TYPES.has(failure.failure_type)) {
        confidence = 65;
    } else if (failure.failure_type === "timeout") {
        if (!sourceAttribution || history) {
            reasons.push("Timed out with no other evidence. Could be slowness, the environment or a regression.");
            if (history) reasons.push(historyReason(history));
            return { category: history ? "flaky" : "unknown", confidence: history ? 60 : 40, reasons };
        }
        confidence = 50;
    } else {
        if (!sourceAttribution) {
            reasons.push("Error type could not be determined.");
            return { category: "unknown", confidence: 35, reasons };
        }
        confidence = 45;
    }

    if (attempts === 1) confidence -= 10;
    if (sourceAttribution) {
        reasons.push(`Likely related change: ${sourceAttribution.path} (${sourceAttribution.evidence})`);
        confidence += sourceAttribution.confidence >= 50 ? 15 : 10;
    }
    if (failure.source === "ai" && failure.confidence >= 80) {
        reasons.push(`AI analysis agrees (${failure.failure_type}, ${failure.confidence}% confidence).`);
        confidence += 5;
    }
    if (history) {
        reasons.push(historyReason(history));
        confidence -= 15;
    }

    return { category: "regression", confidence: clamp(confidence), reasons };
}

function firstLine(message: string): string {
    const line = message.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

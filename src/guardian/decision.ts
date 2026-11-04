import type { ClassifiedFailure, FailureGroup, ReleaseDecision, RiskScore } from "./types";

/** A new regression at or above this confidence blocks on its own. */
export const BLOCK_CONFIDENCE = 70;
/** Infrastructure failures above this share of the suite mean the run didn't really verify the PR. */
export const INFRA_SHARE_LIMIT = 0.2;
export const INFRA_COUNT_LIMIT = 5;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function causeSuffix(group: FailureGroup | undefined): string {
    if (!group || group.rootCauseKind !== "changed_file") return "";
    const commit = group.commit ? ` (commit ${group.commit.slice(0, 7)})` : "";
    return ` Likely cause: ${group.rootCause}${commit}.`;
}

export function decideRelease(input: {
    failures: ClassifiedFailure[];
    groups: FailureGroup[];
    risk: RiskScore;
    testsAnalyzed?: number;
    /** Tests Playwright reported as failed after retries (run-summary.json), if known. */
    failedInRun?: number;
}): { decision: ReleaseDecision; reason: string } {
    // Playwright says tests failed, but no failure was recorded (e.g. the browser never started,
    // or the hooks aren't installed). Without the details nothing can be judged, so never SAFE.
    const recordedFailing = input.failures.filter((f) => f.classification.category !== "flaky").length;
    if ((input.failedInRun ?? 0) > 0 && recordedFailing === 0) {
        return {
            decision: "REVIEW REQUIRED",
            reason: `${plural(input.failedInRun!, "test")} failed, but no failure details were recorded, so they couldn't be analyzed. Check the test run log.`,
        };
    }

    const fresh = input.failures.filter((f) => f.lifecycle === "new");
    const of = (c: string) => fresh.filter((f) => f.classification.category === c);
    const regressions = of("regression");
    const primary = input.groups.find((g) => g.category === "regression");

    const confident = regressions.filter((f) => f.classification.confidence >= BLOCK_CONFIDENCE);
    const highRisk = input.risk.level === "HIGH" || input.risk.level === "CRITICAL";

    if (regressions.length > 0 && (confident.length > 0 || highRisk)) {
        const all = [...new Set(regressions.map((f) => f.area))];
        const areas = all.length > 3 ? [...all.slice(0, 3), `${all.length - 3} more`] : all;
        return {
            decision: "BLOCK",
            reason: `${plural(regressions.length, "new regression")} in ${areas.join(", ")}.` + causeSuffix(primary),
        };
    }

    const concerns: string[] = [];
    if (regressions.length > 0) concerns.push(`${plural(regressions.length, "possible regression")} with low confidence`);
    if (of("unknown").length > 0) concerns.push(`${plural(of("unknown").length, "new failure")} that couldn't be classified`);
    if (of("test_issue").length > 0) concerns.push(`${plural(of("test_issue").length, "broken test")}`);

    const infra = of("infrastructure").length;
    const total = input.testsAnalyzed ?? 0;
    if (infra >= INFRA_COUNT_LIMIT || (total > 0 && infra / total > INFRA_SHARE_LIMIT)) {
        concerns.push(`${plural(infra, "test")} couldn't reach the environment, rerun before trusting this result`);
    }
    if (concerns.length === 0 && input.risk.score >= 30) concerns.push(`risk is ${input.risk.level}`);

    if (concerns.length > 0) {
        return { decision: "REVIEW REQUIRED", reason: `Needs a look: ${concerns.join("; ")}.` };
    }

    if (fresh.length === 0) {
        return { decision: "SAFE TO MERGE", reason: "No new failures introduced by this PR." };
    }

    const parts = [
        of("flaky").length ? plural(of("flaky").length, "flaky test") : "",
        infra ? plural(infra, "infrastructure failure") : "",
    ].filter(Boolean);
    return {
        decision: "SAFE TO MERGE",
        reason: `No regressions. Only ${parts.join(" and ")}, which ${fresh.length === 1 ? "doesn't" : "don't"} block.`,
    };
}

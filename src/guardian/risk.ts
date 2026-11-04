import type { ClassifiedFailure, FailureGroup, RiskLevel, RiskScore } from "./types";

/**
 * Scoring weights. Additive, capped per factor, total capped at 100.
 * Exported so the formula is inspectable and documented in one place.
 */
export const RISK_WEIGHTS = {
    firstRegression: 40,
    additionalRegression: 15,
    regressionCap: 70,
    criticalAreaRegression: 20,
    criticalAreaOther: 10,
    extraArea: 5,
    extraAreaCap: 10,
    unknown: 10,
    unknownCap: 20,
    testIssue: 5,
    testIssueCap: 10,
    infrastructure: 5,
    infrastructureCap: 15,
    flaky: 2,
    flakyCap: 6,
    uncertainRootCause: 5,
} as const;

export function riskLevel(score: number): RiskLevel {
    if (score >= 80) return "CRITICAL";
    if (score >= 60) return "HIGH";
    if (score >= 30) return "MEDIUM";
    return "LOW";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Risk from failures this PR introduced. Pre-existing failures add nothing. */
export function scoreRisk(failures: ClassifiedFailure[], groups: FailureGroup[]): RiskScore {
    const W = RISK_WEIGHTS;
    const fresh = failures.filter((f) => f.lifecycle === "new");
    const of = (c: string) => fresh.filter((f) => f.classification.category === c);

    const regressions = of("regression");
    const reasons: string[] = [];
    let score = 0;

    const add = (points: number, reason: string) => {
        if (points <= 0) return;
        score += points;
        reasons.push(`+${points} ${reason}`);
    };

    if (regressions.length > 0) {
        add(
            Math.min(W.regressionCap, W.firstRegression + W.additionalRegression * (regressions.length - 1)),
            plural(regressions.length, "new regression")
        );

        const critical = [...new Set(regressions.filter((f) => f.critical).map((f) => f.area))];
        if (critical.length > 0) add(W.criticalAreaRegression, `regression in critical area: ${critical.join(", ")}`);

        const areas = new Set(regressions.map((f) => f.area));
        if (areas.size > 1) {
            add(Math.min(W.extraAreaCap, W.extraArea * (areas.size - 1)), `${areas.size} areas affected`);
        }

        const regressionGroups = groups.filter((g) => g.category === "regression");
        if (regressionGroups.length > 0 && Math.max(...regressionGroups.map((g) => g.confidence)) < 50) {
            add(W.uncertainRootCause, "root cause uncertain");
        }
    }

    const unknown = of("unknown");
    add(Math.min(W.unknownCap, W.unknown * unknown.length), plural(unknown.length, "unexplained new failure"));
    if (regressions.length === 0 && unknown.some((f) => f.critical)) {
        add(W.criticalAreaOther, "unexplained failure in a critical area");
    }

    add(Math.min(W.testIssueCap, W.testIssue * of("test_issue").length), plural(of("test_issue").length, "test issue"));
    add(
        Math.min(W.infrastructureCap, W.infrastructure * of("infrastructure").length),
        plural(of("infrastructure").length, "infrastructure failure")
    );
    add(Math.min(W.flakyCap, W.flaky * of("flaky").length), plural(of("flaky").length, "flaky failure"));

    score = Math.min(100, score);
    if (reasons.length === 0) reasons.push("No new failures.");

    return { score, level: riskLevel(score), reasons };
}

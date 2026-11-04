import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiProvider } from "../ai/types";
import type { DiffResult, Failure } from "../lib/types";
import {
    AI_ATTRIBUTION_CAP,
    buildRootCausePrompt,
    explainRootCauses,
    failureRef,
    filesForAi,
    parseOverview,
    parseRootCauseResponse,
} from "./aiRootCause";
import { analyzeRelease } from "./analyzeRelease";
import { formatReleaseComment } from "./format";

const f = (file: string, over: Partial<Failure> = {}): Failure => ({
    file,
    line: 5,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 60,
    retry: 1,
    title: "cart total includes shipping",
    errorMessage: 'Error: expect(locator).toHaveText(expected) failed\nExpected: "30"\nReceived: "29"\nCall log:\n  - waiting',
    source: "heuristic",
    ...over,
});

const diff = (newFailures: Failure[]): DiffResult => ({ newFailures, unchangedFailures: [], fixedFailures: [] });

// The cause is in money.ts, which shares no words with the checkout test:
// the naming heuristic can't find it, only reading the diff can.
const changes = {
    files: [
        { path: "src/lib/money.ts", commit: "aaaa1111", commitSubject: "faster rounding" },
        { path: "src/ui/theme.ts", commit: "bbbb2222" },
        { path: "README.md" },
    ],
};
const patches = {
    "src/lib/money.ts": "@@ -1 +1 @@\n-export const roundCents = (n: number) => Math.round(n);\n+export const roundCents = (n: number) => Math.floor(n);",
    "src/ui/theme.ts": "@@ -1 +1 @@\n-export const accent = 'blue';\n+export const accent = 'teal';",
};

function fakeProvider(content: string): AiProvider & { prompts: string[] } {
    const prompts: string[] = [];
    return {
        name: "fake",
        model: "claude-haiku-5-5",
        prompts,
        analyze: async (prompt: string) => {
            prompts.push(prompt);
            return { content, estimatedCostUsd: 0.0021 };
        },
    };
}

const answer = (o: Record<string, unknown>) => JSON.stringify([{ id: "G1", ...o }]);

describe("filesForAi", () => {
    it("sends source changes and skips docs/lockfiles", () => {
        const report = analyzeRelease(diff([f("tests/checkout.spec.ts")]), { changes });
        assert.deepEqual(filesForAi(report, changes.files), ["src/lib/money.ts", "src/ui/theme.ts"]);
    });
});

describe("buildRootCausePrompt", () => {
    it("includes each problem's tests and error, and the diff, without the call log", () => {
        const report = analyzeRelease(diff([f("tests/checkout.spec.ts")]), { changes });
        const prompt = buildRootCausePrompt(report, patches);
        assert.match(prompt, /tests\/checkout\.spec\.ts:5 \\"cart total includes shipping\\"/);
        assert.match(prompt, /Received: \\"29\\"/);
        assert.match(prompt, /### src\/lib\/money\.ts\n@@ -1 \+1 @@/);
        assert.match(prompt, /\+export const roundCents = \(n: number\) => Math\.floor\(n\);/);
        assert.doesNotMatch(prompt, /Call log/);
        assert.match(prompt, /or null/);
    });
});

describe("parseRootCauseResponse", () => {
    const report = analyzeRelease(diff([f("tests/checkout.spec.ts")]), { changes });
    const paths = changes.files.map((c) => c.path);

    it("maps a valid answer onto every failure in the group", () => {
        const causes = parseRootCauseResponse(
            "```json\n" + answer({ file: "src/lib/money.ts", summary: "roundCents now floors, 29.9 becomes 29.", fix: "Use Math.round again.", confidence: 90 }) + "\n```",
            report,
            paths
        );
        assert.deepEqual(causes[failureRef(report.groups[0].failures[0].failure)], {
            path: "src/lib/money.ts",
            summary: "roundCents now floors, 29.9 becomes 29.",
            fix: "Use Math.round again.",
            confidence: 90,
        });
    });

    it("rejects files that are not in the diff, unknown ids, junk and em dashes", () => {
        const invented = parseRootCauseResponse(answer({ file: "src/made/up.ts", summary: "x \u2014 y", confidence: 99 }), report, paths);
        const cause = Object.values(invented)[0];
        assert.equal(cause.path, null, "invented file dropped, explanation kept");
        assert.equal(cause.summary, "x, y", "em dash from the AI is rewritten");
        assert.deepEqual(parseRootCauseResponse(JSON.stringify([{ id: "G9", file: "src/lib/money.ts", summary: "s", confidence: 90 }]), report, paths), {});
        assert.deepEqual(parseRootCauseResponse("sorry, I can't help", report, paths), {});
        assert.equal(Object.values(parseRootCauseResponse(answer({ file: "src/lib/money.ts", summary: "s", confidence: 400 }), report, paths))[0].confidence, 100);
    });
});

describe("AI root cause in the release report", () => {
    it("finds a cause the naming heuristic misses, capped, and explains it", async () => {
        const failures = [f("tests/checkout.spec.ts")];
        const before = analyzeRelease(diff(failures), { changes });
        assert.equal(before.primaryGroup?.rootCauseKind, "error_signature", "heuristic can't link money.ts");

        const provider = fakeProvider(answer({ file: "src/lib/money.ts", summary: "roundCents now floors, so 29.9 becomes 29.", fix: "Use Math.round.", confidence: 95 }));
        const { causes, costUsd } = await explainRootCauses(before, changes.files, patches, provider);
        const after = analyzeRelease(diff(failures), { changes, aiCauses: causes, ai: { model: provider.model, provider: "fake", costUsd } });

        assert.equal(after.primaryGroup?.rootCause, "src/lib/money.ts");
        assert.equal(after.primaryGroup?.commit, "aaaa1111");
        assert.equal(after.failures[0].attribution?.kind, "ai");
        assert.equal(after.failures[0].attribution?.confidence, AI_ATTRIBUTION_CAP, "95 is capped");

        const md = formatReleaseComment(after, undefined, { commit: "" });
        assert.match(md, /likely cause <code>src\/lib\/money\.ts<\/code>/);
        assert.match(md, /\*\*AI:\*\* roundCents now floors, so 29\.9 becomes 29\./);
        assert.match(md, /\*\*Fix:\*\* Use Math\.round\./);
        assert.match(md, /<sub>AI root cause: claude-haiku-5-5 · ~\$0\.0021<\/sub>/);
        assert.equal((md.match(/roundCents now floors/g) ?? []).length, 1, "explanation shown once");
    });

    it("ignores a low-confidence file pick but still shows the explanation", () => {
        const failures = [f("tests/checkout.spec.ts")];
        const before = analyzeRelease(diff(failures), { changes });
        const causes = parseRootCauseResponse(answer({ file: "src/ui/theme.ts", summary: "Only a color changed; unclear.", confidence: 30 }), before, changes.files.map((c) => c.path));
        const after = analyzeRelease(diff(failures), { changes, aiCauses: causes });
        assert.equal(after.failures[0].attribution, undefined);
        assert.match(formatReleaseComment(after, undefined, { commit: "" }), /\*\*AI:\*\* Only a color changed; unclear\./);
    });

    it("AI and heuristic agreeing corroborate each other", () => {
        const failures = [f("tests/checkout.spec.ts")];
        const cartChanges = { files: [{ path: "src/checkout/cartTotal.ts", commit: "cccc3333" }] };
        const before = analyzeRelease(diff(failures), { changes: cartChanges });
        const heuristic = before.failures[0].attribution!.confidence;
        const causes = parseRootCauseResponse(answer({ file: "src/checkout/cartTotal.ts", summary: "Total dropped shipping.", confidence: 80 }), before, ["src/checkout/cartTotal.ts"]);
        const after = analyzeRelease(diff(failures), { changes: cartChanges, aiCauses: causes });
        assert.ok(after.failures[0].attribution!.confidence > Math.max(heuristic, 80));
        assert.ok(after.failures[0].attribution!.confidence <= 90);
    });

    it("the AI can't change a flaky or infrastructure verdict", () => {
        const flaky = f("tests/search.spec.ts", { is_flaky_suspected: true });
        const before = analyzeRelease(diff([flaky]), { changes });
        assert.equal(before.decision, "SAFE TO MERGE");
        // Not even asked: flaky groups aren't sent to the AI.
        assert.match(buildRootCausePrompt(before, patches), /"Problems:"|Problems:\n\[\]/);
    });

    it("skips the call when there is nothing to explain or no diff", async () => {
        const provider = fakeProvider("[]");
        const clean = analyzeRelease(diff([]), { changes });
        assert.deepEqual(await explainRootCauses(clean, changes.files, patches, provider), { causes: {} });
        const failing = analyzeRelease(diff([f("tests/checkout.spec.ts")]), { changes });
        assert.deepEqual(await explainRootCauses(failing, changes.files, {}, provider), { causes: {} });
        assert.equal(provider.prompts.length, 0, "no paid calls");
    });
});

describe("AI overview", () => {
    const two = [
        f("tests/checkout.spec.ts"),
        f("tests/profile.spec.ts", { title: "avatar upload", errorMessage: 'Expected: "ok"\nReceived: "error"' }),
    ];
    const objectAnswer = JSON.stringify({
        overview: "Checkout totals are one short because roundCents now floors. The avatar upload failure looks unrelated to this PR's diff.",
        problems: [
            { id: "G1", file: "src/lib/money.ts", summary: "roundCents floors, 29.6 becomes 29.", fix: "Use Math.round.", confidence: 90 },
            { id: "G2", file: null, summary: "No change in the diff touches uploads.", confidence: 10 },
        ],
    });

    it("parses the overview and the problems from the object answer", () => {
        const report = analyzeRelease(diff(two), { changes });
        assert.match(parseOverview(objectAnswer) ?? "", /^Checkout totals are one short/);
        const causes = parseRootCauseResponse(objectAnswer, report, changes.files.map((c) => c.path));
        assert.equal(Object.keys(causes).length, 2);
    });

    it("asks for an overview and passes flaky/infra failures only as context", () => {
        const report = analyzeRelease(diff([...two, f("tests/search.spec.ts", { is_flaky_suspected: true })]), { changes });
        const prompt = buildRootCausePrompt(report, patches);
        assert.match(prompt, /"overview"/);
        assert.match(prompt, /Also failed \(already classified, do not analyze\):\n\[\n  \{\n    "category": "flaky"/);
        const problems = prompt.slice(prompt.indexOf("Problems:"), prompt.indexOf("Also failed"));
        assert.equal((problems.match(/"id": "G/g) ?? []).length, 2, "only the two real problems get ids");
    });

    it("shows the summary above the list with 2+ problems, not with 1", async () => {
        const provider = fakeProvider(objectAnswer);
        const before = analyzeRelease(diff(two), { changes });
        const { causes, overview } = await explainRootCauses(before, changes.files, patches, provider);
        const md = formatReleaseComment(analyzeRelease(diff(two), { changes, aiCauses: causes, aiOverview: overview }), undefined, { commit: "" });
        const summaryAt = md.indexOf("**AI summary:** Checkout totals are one short");
        assert.ok(summaryAt > 0 && summaryAt < md.indexOf("<details>"), "summary sits before the problem list");

        const single = analyzeRelease(diff([two[0]]), { changes, aiOverview: overview });
        assert.doesNotMatch(formatReleaseComment(single, undefined, { commit: "" }), /AI summary/);
    });

    it("still reads the older bare-array answer", () => {
        const report = analyzeRelease(diff([two[0]]), { changes });
        const causes = parseRootCauseResponse(answer({ file: "src/lib/money.ts", summary: "s", confidence: 80 }), report, ["src/lib/money.ts"]);
        assert.equal(Object.values(causes)[0].path, "src/lib/money.ts");
        assert.equal(parseOverview(answer({ file: null, summary: "s", confidence: 1 })), undefined);
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatAiSummaryMarkdown,
    formatCostRollupLine,
    titleFromMetaPath,
    totalEstimatedCostUsd,
} from "./aiSummary";

describe("titleFromMetaPath", () => {
    it("extracts spec/test/attempt from artifact path", () => {
        assert.equal(
            titleFromMetaPath(
                "artifacts/run/login.spec.ts/user_can_sign_in/attempt-1/meta.json"
            ),
            "login.spec.ts/user_can_sign_in/attempt-1"
        );
    });
});

describe("ai summary formatting", () => {
    const entries = [
        {
            metaPath:
                "artifacts/run/login.spec.ts/user_can_sign_in/attempt-1/meta.json",
            relativePath:
                "login.spec.ts/user_can_sign_in/attempt-1/ai.txt",
            content: "Root cause: timeout",
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            estimatedCostUsd: 0.001,
        },
        {
            metaPath:
                "artifacts/run/login.spec.ts/wrong_password/attempt-1/meta.json",
            relativePath: "login.spec.ts/wrong_password/attempt-1/ai.txt",
            content: "Root cause: assertion",
            estimatedCostUsd: 0.002,
        },
    ];

    it("sums estimated costs", () => {
        assert.equal(totalEstimatedCostUsd(entries), 0.003);
    });

    it("formats a single rollup console line", () => {
        assert.equal(
            formatCostRollupLine({
                provider: "anthropic",
                model: "claude-haiku-4-5",
                entries,
            }),
            "AI analysis: 2 failures · anthropic (claude-haiku-4-5) · ~$0.003000 estimated"
        );
    });

    it("writes a combined markdown summary", () => {
        const md = formatAiSummaryMarkdown({
            provider: "anthropic",
            model: "claude-haiku-4-5",
            entries,
        });

        assert.match(md, /# AI failure analysis summary/);
        assert.match(md, /Failures analyzed: 2/);
        assert.match(md, /Estimated cost \(approx\): \$0\.003000/);
        assert.match(md, /## login\.spec\.ts\/user_can_sign_in\/attempt-1/);
        assert.match(md, /Root cause: timeout/);
        assert.match(md, /Root cause: assertion/);
    });
});

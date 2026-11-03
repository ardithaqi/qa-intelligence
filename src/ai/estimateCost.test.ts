import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    estimateAnthropicCost,
    estimateCostUsd,
    formatUsd,
    resolveAnthropicRates,
} from "./estimateCost";

describe("resolveAnthropicRates", () => {
    it("uses exact model pricing when listed", () => {
        assert.deepEqual(resolveAnthropicRates("claude-haiku-5-5"), { input: 0.1, output: 0.5 });
        assert.deepEqual(resolveAnthropicRates("claude-opus-4-8"), { input: 5, output: 25 });
        assert.deepEqual(resolveAnthropicRates("claude-opus-5"), {
            input: 5,
            output: 25,
        });
    });

    it("falls back by model name substring", () => {
        assert.deepEqual(resolveAnthropicRates("claude-haiku-9-9"), {
            input: 1,
            output: 5,
        });
        assert.deepEqual(resolveAnthropicRates("claude-opus-4-1"), {
            input: 5,
            output: 25,
        });
    });

    it("defaults to sonnet pricing for unknown models", () => {
        assert.deepEqual(resolveAnthropicRates("claude-unknown"), {
            input: 3,
            output: 15,
        });
    });
});

describe("estimateAnthropicCost", () => {
    it("estimates haiku-style cost from input/output tokens", () => {
        const cost = estimateAnthropicCost("claude-haiku-4-5", {
            inputTokens: 944,
            outputTokens: 263,
        });
        assert.ok(cost !== undefined);
        // 944/1e6 * 1 + 263/1e6 * 5 = 0.002259
        assert.equal(Number(cost!.toFixed(6)), 0.002259);
    });
});

describe("estimateCostUsd", () => {
    it("uses anthropic model pricing when model is provided", () => {
        const cost = estimateCostUsd(
            "anthropic",
            { inputTokens: 944, outputTokens: 263 },
            "claude-haiku-5-5"
        );
        // 944/1e6 * 0.1 + 263/1e6 * 0.5 = 0.0002259
        assert.equal(Number(cost!.toFixed(7)), 0.0002259);
    });

    it("estimates openai cost from input/output tokens", () => {
        const cost = estimateCostUsd("openai", {
            inputTokens: 1000,
            outputTokens: 500,
        });
        assert.ok(cost !== undefined);
        // 1000/1e6 * 0.15 + 500/1e6 * 0.6 = 0.00045
        assert.equal(Number(cost!.toFixed(6)), 0.00045);
    });

    it("returns undefined when usage is missing", () => {
        assert.equal(estimateCostUsd("openai", undefined), undefined);
    });
});

describe("formatUsd", () => {
    it("formats to 6 decimal places", () => {
        assert.equal(formatUsd(0.001807), "$0.001807");
    });
});

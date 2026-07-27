import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateCostUsd, formatUsd } from "./estimateCost";

describe("estimateCostUsd", () => {
    it("estimates anthropic haiku-style cost from input/output tokens", () => {
        const cost = estimateCostUsd("anthropic", {
            inputTokens: 944,
            outputTokens: 263,
        });
        assert.ok(cost !== undefined);
        // 944/1e6 * 0.8 + 263/1e6 * 4 = 0.0018072
        assert.equal(Number(cost!.toFixed(6)), 0.001807);
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

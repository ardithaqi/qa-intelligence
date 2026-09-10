import { AiProviderName } from "./config";
import { AiUsage } from "./types";

/** USD per million tokens (approx; pricing drifts — treat as estimate only). */
const RATES: Record<
    AiProviderName,
    { inputPerMTok: number; outputPerMTok: number }
> = {
    openai: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    "openai-compatible": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    anthropic: { inputPerMTok: 0.8, outputPerMTok: 4.0 },
};

const ANTHROPIC_PRICING_PER_M: Record<
    string,
    { input: number; output: number }
> = {
    "claude-opus-5": { input: 5, output: 25 },
    "claude-opus-4-8": { input: 15, output: 75 },
    "claude-opus-4-6": { input: 15, output: 75 },
    "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
    "claude-3-5-sonnet-latest": { input: 3, output: 15 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
};

export function resolveAnthropicRates(model: string): {
    input: number;
    output: number;
} {
    if (ANTHROPIC_PRICING_PER_M[model]) return ANTHROPIC_PRICING_PER_M[model];
    if (model.includes("opus")) return { input: 5, output: 25 };
    if (model.includes("haiku")) return { input: 0.8, output: 4 };
    return { input: 3, output: 15 };
}

export function estimateAnthropicCost(
    model: string,
    usage: AiUsage | undefined
): number | undefined {
    if (!usage) return undefined;

    const rates = resolveAnthropicRates(model);
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;

    if (input === 0 && output === 0) return undefined;

    return (
        (input / 1_000_000) * rates.input +
        (output / 1_000_000) * rates.output
    );
}

export function estimateCostUsd(
    provider: AiProviderName,
    usage: AiUsage | undefined,
    model?: string
): number | undefined {
    if (!usage) return undefined;

    if (provider === "anthropic") {
        return estimateAnthropicCost(model ?? "", usage);
    }

    const rates = RATES[provider];
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;

    if (input === 0 && output === 0) {
        const total = usage.totalTokens ?? 0;
        if (total === 0) return undefined;
        // Fallback when providers only expose total tokens
        const blended = (rates.inputPerMTok + rates.outputPerMTok) / 2;
        return (total / 1_000_000) * blended;
    }

    return (
        (input / 1_000_000) * rates.inputPerMTok +
        (output / 1_000_000) * rates.outputPerMTok
    );
}

export function formatUsd(amount: number): string {
    return `$${amount.toFixed(6)}`;
}

export function logUsageAndCost(
    usage: unknown,
    estimatedCostUsd: number | undefined
): void {
    if (usage) {
        console.log("Token usage:", usage);
    }
    if (estimatedCostUsd !== undefined) {
        console.log(
            `Estimated cost (approx): $${estimatedCostUsd.toFixed(6)}`
        );
    }
}

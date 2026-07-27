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

export function estimateCostUsd(
    provider: AiProviderName,
    usage: AiUsage | undefined
): number | undefined {
    if (!usage) return undefined;

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

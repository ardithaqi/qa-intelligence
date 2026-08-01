import OpenAI from "openai";
import { AiConfig } from "../config";
import { estimateCostUsd, logUsageAndCost } from "../estimateCost";
import { AiAnalysisResult, AiProvider } from "../types";

export function createOpenAiProvider(config: AiConfig): AiProvider {
    const client = new OpenAI({ apiKey: config.apiKey });

    return {
        name: "openai",
        model: config.model,
        async analyze(prompt: string): Promise<AiAnalysisResult | null> {
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [{ role: "user", content: prompt }],
            });

            const content = response.choices[0]?.message?.content;
            if (!content) return null;

            const usage = response.usage
                ? {
                      inputTokens: response.usage.prompt_tokens,
                      outputTokens: response.usage.completion_tokens,
                      totalTokens: response.usage.total_tokens,
                  }
                : undefined;
            const estimatedCostUsd = estimateCostUsd("openai", usage);

            logUsageAndCost(response.usage, estimatedCostUsd);

            return { content, usage, estimatedCostUsd };
        },
    };
}

export function createOpenAiCompatibleProvider(config: AiConfig): AiProvider {
    const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
    });

    return {
        name: "openai-compatible",
        model: config.model,
        async analyze(prompt: string): Promise<AiAnalysisResult | null> {
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [{ role: "user", content: prompt }],
            });

            const content = response.choices[0]?.message?.content;
            if (!content) return null;

            const usage = response.usage
                ? {
                      inputTokens: response.usage.prompt_tokens,
                      outputTokens: response.usage.completion_tokens,
                      totalTokens: response.usage.total_tokens,
                  }
                : undefined;
            const estimatedCostUsd = estimateCostUsd(
                "openai-compatible",
                usage
            );

            logUsageAndCost(response.usage, estimatedCostUsd);

            return { content, usage, estimatedCostUsd };
        },
    };
}

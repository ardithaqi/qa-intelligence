import OpenAI from "openai";
import { AiConfig } from "../config";
import { AiAnalysisResult, AiProvider } from "../types";

// Rough estimate for gpt-4o-mini (adjust if pricing changes)
const OPENAI_MINI_COST_PER_1K_TOKENS = 0.00015;

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

            const usage = response.usage;
            if (usage) {
                console.log("Token usage:", usage);
                const estimatedCost =
                    ((usage.total_tokens ?? 0) / 1000) *
                    OPENAI_MINI_COST_PER_1K_TOKENS;
                console.log(
                    `Estimated cost (approx): $${estimatedCost.toFixed(6)}`
                );
            }

            return {
                content,
                usage: usage
                    ? {
                          inputTokens: usage.prompt_tokens,
                          outputTokens: usage.completion_tokens,
                          totalTokens: usage.total_tokens,
                      }
                    : undefined,
            };
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

            const usage = response.usage;
            if (usage) {
                console.log("Token usage:", usage);
            }

            return {
                content,
                usage: usage
                    ? {
                          inputTokens: usage.prompt_tokens,
                          outputTokens: usage.completion_tokens,
                          totalTokens: usage.total_tokens,
                      }
                    : undefined,
            };
        },
    };
}

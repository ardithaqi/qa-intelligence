import { AiConfig } from "../config";
import { estimateCostUsd } from "../estimateCost";
import { AiAnalysisResult, AiProvider } from "../types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicResponse {
    content?: Array<{ type?: string; text?: string }>;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
}

function isVerbose(): boolean {
    return process.env.AI_VERBOSE === "true";
}

export function createAnthropicProvider(config: AiConfig): AiProvider {
    return {
        name: "anthropic",
        model: config.model,
        async analyze(prompt: string): Promise<AiAnalysisResult | null> {
            const response = await fetch(ANTHROPIC_API_URL, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": config.apiKey!,
                    "anthropic-version": ANTHROPIC_VERSION,
                },
                body: JSON.stringify({
                    model: config.model,
                    max_tokens: 4096,
                    messages: [{ role: "user", content: prompt }],
                }),
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(
                    `Anthropic API error (${response.status}): ${body}`
                );
            }

            const data = (await response.json()) as AnthropicResponse;
            const content = data.content
                ?.map((block) => block.text ?? "")
                .join("")
                .trim();

            if (!content) return null;

            const usage = data.usage
                ? {
                      inputTokens: data.usage.input_tokens,
                      outputTokens: data.usage.output_tokens,
                      totalTokens:
                          (data.usage.input_tokens ?? 0) +
                          (data.usage.output_tokens ?? 0),
                  }
                : undefined;
            const estimatedCostUsd = estimateCostUsd("anthropic", usage);

            if (isVerbose() && data.usage) {
                console.log("Token usage:", data.usage);
                if (estimatedCostUsd !== undefined) {
                    console.log(
                        `Estimated cost (approx): $${estimatedCostUsd.toFixed(6)}`
                    );
                }
            }

            return { content, usage, estimatedCostUsd };
        },
    };
}

import { z } from "zod";

export const AI_PROVIDERS = ["openai", "openai-compatible", "anthropic"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

const DEFAULT_MODELS: Record<AiProviderName, string> = {
    openai: "gpt-4o-mini",
    "openai-compatible": "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-latest",
};

const AiConfigSchema = z.object({
    provider: z.enum(AI_PROVIDERS).default("openai"),
    model: z.string().min(1).optional(),
    openaiApiKey: z.string().min(1).optional(),
    anthropicApiKey: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
});

export type AiConfig = z.infer<typeof AiConfigSchema> & {
    model: string;
    apiKey: string;
};

function readEnv(env: NodeJS.ProcessEnv = process.env): z.infer<typeof AiConfigSchema> | null {
    const parsed = AiConfigSchema.safeParse({
        provider: env.AI_PROVIDER?.toLowerCase(),
        model: env.AI_MODEL,
        openaiApiKey: env.OPENAI_API_KEY,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        apiKey: env.AI_API_KEY,
        baseUrl: env.AI_BASE_URL,
    });

    if (!parsed.success) {
        console.warn("Invalid AI configuration:", parsed.error.flatten().fieldErrors);
        return null;
    }

    return parsed.data;
}

export function resolveApiKey(
    config: z.infer<typeof AiConfigSchema>
): string | undefined {
    switch (config.provider) {
        case "openai":
            return config.openaiApiKey ?? config.apiKey;
        case "anthropic":
            return config.anthropicApiKey ?? config.apiKey;
        case "openai-compatible":
            return config.apiKey ?? config.openaiApiKey;
        default:
            return config.apiKey;
    }
}

export function resolveAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
    const parsed = readEnv(env);
    if (!parsed) return null;

    const apiKey = resolveApiKey(parsed);

    if (parsed.provider === "openai-compatible" && !parsed.baseUrl) {
        console.warn(
            "AI_BASE_URL is required when AI_PROVIDER=openai-compatible. Skipping AI failure analysis."
        );
        return null;
    }

    if (!apiKey) {
        const keyHint =
            parsed.provider === "anthropic"
                ? "ANTHROPIC_API_KEY or AI_API_KEY"
                : parsed.provider === "openai-compatible"
                  ? "AI_API_KEY"
                  : "OPENAI_API_KEY or AI_API_KEY";
        console.warn(`${keyHint} is not set. Skipping AI failure analysis.`);
        return null;
    }

    return {
        ...parsed,
        model: parsed.model ?? DEFAULT_MODELS[parsed.provider],
        apiKey,
    };
}

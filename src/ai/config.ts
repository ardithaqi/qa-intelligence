import { z } from "zod";

export const AI_PROVIDERS = ["openai", "openai-compatible", "anthropic"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

const DEFAULT_MODELS: Record<AiProviderName, string> = {
    openai: "gpt-4o-mini",
    "openai-compatible": "gpt-4o-mini",
    // claude-3-5-haiku-latest was retired (404); Haiku 5.5 is the current fast, cheap model.
    anthropic: "claude-haiku-5-5",
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

/**
 * Empty or whitespace-only values count as "not set". GitHub Actions renders a
 * missing secret (`${{ secrets.OPENAI_API_KEY }}`) as "", which used to fail
 * validation and silently disable AI even when another provider's key was set.
 */
function setting(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

/** No AI_PROVIDER: use OpenAI if its key is set, else Anthropic if only that key is set. */
function inferProvider(env: NodeJS.ProcessEnv): AiProviderName | undefined {
    if (setting(env.OPENAI_API_KEY)) return "openai";
    if (setting(env.ANTHROPIC_API_KEY)) return "anthropic";
    return undefined;
}

function readEnv(env: NodeJS.ProcessEnv = process.env): z.infer<typeof AiConfigSchema> | null {
    const parsed = AiConfigSchema.safeParse({
        provider: setting(env.AI_PROVIDER)?.toLowerCase() ?? inferProvider(env),
        model: setting(env.AI_MODEL),
        openaiApiKey: setting(env.OPENAI_API_KEY),
        anthropicApiKey: setting(env.ANTHROPIC_API_KEY),
        apiKey: setting(env.AI_API_KEY),
        baseUrl: setting(env.AI_BASE_URL),
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

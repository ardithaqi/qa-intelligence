import { resolveAiConfig } from "./config";
import { createAnthropicProvider } from "./providers/anthropic";
import {
    createOpenAiCompatibleProvider,
    createOpenAiProvider,
} from "./providers/openai";
import { AiProvider } from "./types";

export function createAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
    const config = resolveAiConfig(env);
    if (!config) return null;

    switch (config.provider) {
        case "openai":
            return createOpenAiProvider(config);
        case "openai-compatible":
            return createOpenAiCompatibleProvider(config);
        case "anthropic":
            return createAnthropicProvider(config);
        default:
            console.warn(
                `Unsupported AI_PROVIDER "${config.provider}". Skipping AI failure analysis.`
            );
            return null;
    }
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAiConfig, resolveApiKey } from "./config";
import { createAiProvider } from "./getProvider";
import { buildFailureAnalysisPrompt } from "./prompt";

describe("resolveAiConfig", () => {
    it("defaults to openai with gpt-4o-mini when OPENAI_API_KEY is set", () => {
        const config = resolveAiConfig({
            OPENAI_API_KEY: "sk-test",
        });

        assert.ok(config);
        assert.equal(config.provider, "openai");
        assert.equal(config.model, "gpt-4o-mini");
        assert.equal(config.apiKey, "sk-test");
    });

    it("uses AI_MODEL when provided", () => {
        const config = resolveAiConfig({
            OPENAI_API_KEY: "sk-test",
            AI_MODEL: "gpt-4o",
        });

        assert.ok(config);
        assert.equal(config.model, "gpt-4o");
    });

    it("returns null when openai provider has no API key", () => {
        const config = resolveAiConfig({});
        assert.equal(config, null);
    });

    it("accepts AI_API_KEY for openai", () => {
        const config = resolveAiConfig({
            AI_API_KEY: "generic-key",
        });

        assert.ok(config);
        assert.equal(config.apiKey, "generic-key");
    });

    it("resolves anthropic provider and default model", () => {
        const config = resolveAiConfig({
            AI_PROVIDER: "anthropic",
            ANTHROPIC_API_KEY: "anthropic-key",
        });

        assert.ok(config);
        assert.equal(config.provider, "anthropic");
        assert.equal(config.model, "claude-3-5-haiku-latest");
        assert.equal(config.apiKey, "anthropic-key");
    });

    it("requires AI_BASE_URL for openai-compatible provider", () => {
        const config = resolveAiConfig({
            AI_PROVIDER: "openai-compatible",
            AI_API_KEY: "local-key",
        });

        assert.equal(config, null);
    });

    it("resolves openai-compatible provider with base URL", () => {
        const config = resolveAiConfig({
            AI_PROVIDER: "openai-compatible",
            AI_API_KEY: "local-key",
            AI_BASE_URL: "http://localhost:11434/v1",
            AI_MODEL: "llama3",
        });

        assert.ok(config);
        assert.equal(config.provider, "openai-compatible");
        assert.equal(config.baseUrl, "http://localhost:11434/v1");
        assert.equal(config.model, "llama3");
    });
});

describe("resolveApiKey", () => {
    it("prefers provider-specific keys over AI_API_KEY", () => {
        assert.equal(
            resolveApiKey({
                provider: "openai",
                openaiApiKey: "openai-key",
                apiKey: "generic-key",
            }),
            "openai-key"
        );
    });
});

describe("createAiProvider", () => {
    it("returns an openai provider when configured", () => {
        const provider = createAiProvider({
            OPENAI_API_KEY: "sk-test",
        });

        assert.ok(provider);
        assert.equal(provider.name, "openai");
        assert.equal(provider.model, "gpt-4o-mini");
    });

    it("returns null when not configured", () => {
        assert.equal(createAiProvider({}), null);
    });
});

describe("buildFailureAnalysisPrompt", () => {
    it("includes metadata, error message, and truncated html", () => {
        const prompt = buildFailureAnalysisPrompt({
            meta: { test: "login.spec.ts", line: 12 },
            errorMessage: "Expected 1 to be 2",
            html: "x".repeat(5000),
        });

        assert.match(prompt, /login\.spec\.ts/);
        assert.match(prompt, /Expected 1 to be 2/);
        assert.match(prompt, /STRUCTURED_JSON/);
        assert.match(prompt, /x{4000}/);
        assert.doesNotMatch(prompt, /x{4001}/);
    });
});

export interface FailureAnalysisInput {
    meta: Record<string, unknown>;
    errorMessage: string;
    html: string;
}

export interface AiUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

export interface AiAnalysisResult {
    content: string;
    usage?: AiUsage;
    /** Approximate USD cost for this call; undefined when usage is missing. */
    estimatedCostUsd?: number;
}

export interface AiProvider {
    readonly name: string;
    readonly model: string;
    analyze(prompt: string): Promise<AiAnalysisResult | null>;
}

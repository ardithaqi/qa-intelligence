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
}

export interface AiProvider {
    readonly name: string;
    readonly model: string;
    analyze(prompt: string): Promise<AiAnalysisResult | null>;
}

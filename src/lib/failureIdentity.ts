export function normalizeTestPath(file: string): string {
    const p = file.replace(/\\/g, "/").trim();

    const testsIdx = p.indexOf("tests/");
    if (testsIdx >= 0) return p.slice(testsIdx);

    return `tests/${p.replace(/^\//, "")}`;
}

export function parseLocationFromStack(
    stack?: string
): { file: string; line: number } | null {
    if (!stack) return null;

    const normalized = stack.replace(/\\/g, "/");
    const match = normalized.match(/(tests\/[^\s:)]+?\.ts):(\d+)/);

    if (!match) return null;

    return {
        file: match[1],
        line: Number(match[2]),
    };
}

export function failureDiffKey(file: string, failure_type: string): string {
    return `${normalizeTestPath(file)}:${failure_type}`;
}

export function parseAttemptFromAiPath(aiTxtPath: string): number {
    const normalized = aiTxtPath.replace(/\\/g, "/");
    const match = normalized.match(/\/attempt-(\d+)\/ai\.txt$/);

    if (!match) return 0;

    const attempt = Number(match[1]);
    return Number.isFinite(attempt) ? attempt : 0;
}

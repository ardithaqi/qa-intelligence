export function normalizeTestPath(file: string): string {
    const p = file.replace(/\\/g, "/").trim();

    const testsIdx = p.indexOf("tests/");
    if (testsIdx >= 0) return p.slice(testsIdx);

    return `tests/${p.replace(/^\//, "")}`;
}

/**
 * First `tests/...ts:line` frame of a stack. With `inFile` (the test's own spec file), the first
 * frame in that file: a failure thrown inside a shared helper (tests/support/...) belongs to the
 * test that called it, at the line where it called it.
 */
export function parseLocationFromStack(
    stack?: string,
    inFile?: string
): { file: string; line: number } | null {
    if (!stack) return null;

    const normalized = stack.replace(/\\/g, "/");
    const frames = [...normalized.matchAll(/(tests\/[^\s:)]+?\.ts):(\d+)/g)].map((m) => ({
        file: m[1],
        line: Number(m[2]),
    }));
    if (inFile) return frames.find((f) => f.file === normalizeTestPath(inFile)) ?? null;
    return frames[0] ?? null;
}

/**
 * Identity of a failure across runs. With the test title, two tests failing the same way in one
 * file stay two failures; without it (old ai.txt-only artifacts), file + type as before.
 */
export function failureDiffKey(file: string, failure_type: string, title?: string): string {
    return title ? `${normalizeTestPath(file)}:${title}:${failure_type}` : `${normalizeTestPath(file)}:${failure_type}`;
}

export function parseAttemptFromAiPath(aiTxtPath: string): number {
    const normalized = aiTxtPath.replace(/\\/g, "/");
    const match = normalized.match(/\/attempt-(\d+)\/ai\.txt$/);

    if (!match) return 0;

    const attempt = Number(match[1]);
    return Number.isFinite(attempt) ? attempt : 0;
}

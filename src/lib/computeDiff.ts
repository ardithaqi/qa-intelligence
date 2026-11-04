import fs from "fs";
import path from "path";
import {
    failureDiffKey,
    normalizeTestPath,
    parseAttemptFromAiPath,
    parseLocationFromStack,
} from "./failureIdentity";
import { inferFailureType, stripAnsi } from "./failureSignals";
import type { Failure } from "./types";

export type { Failure } from "./types";

interface MetaJson {
    title?: string;
    stack?: string;
    errorMessage?: string;
    is_flaky_suspected?: boolean;
    severity?: string;
    file?: string;
    line?: number;
    project?: string;
    retry?: number;
    url?: string;
}

const MAX_ERROR_CHARS = 2000;

function extractTrailingJson(content: string): Partial<Failure> | null {
    const trimmed = content.trimEnd();

    for (
        let i = trimmed.lastIndexOf("{");
        i >= 0;
        i = trimmed.lastIndexOf("{", i - 1)
    ) {
        try {
            return JSON.parse(trimmed.slice(i)) as Partial<Failure>;
        } catch { }
    }

    return null;
}

function readMetaJson(metaPath: string): MetaJson | null {
    if (!fs.existsSync(metaPath)) return null;

    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf8")) as MetaJson;
    } catch {
        return null;
    }
}

function resolveLocation(
    meta: MetaJson | null,
    ai?: Partial<Failure> | null
): { file: string; line: number } | null {
    const fromStack = parseLocationFromStack(meta?.stack);
    const fromMeta =
        typeof meta?.file === "string"
            ? {
                  file: normalizeTestPath(meta.file),
                  line:
                      typeof meta.line === "number" && Number.isFinite(meta.line)
                          ? meta.line
                          : 0,
              }
            : null;

    const rawFile =
        fromStack?.file ?? fromMeta?.file ?? (typeof ai?.file === "string" ? ai.file : "");
    if (!rawFile) return null;

    const line =
        fromStack?.line ??
        fromMeta?.line ??
        (typeof ai?.line === "number" ? ai.line : Number(ai?.line) || 0);

    return { file: normalizeTestPath(rawFile), line };
}

/** Run context from meta.json that downstream classification can use. */
function metaContext(meta: MetaJson | null): Partial<Failure> {
    if (!meta) return {};
    const context: Partial<Failure> = {};
    if (typeof meta.title === "string") context.title = meta.title;
    if (typeof meta.errorMessage === "string" && meta.errorMessage) {
        context.errorMessage = stripAnsi(meta.errorMessage).slice(0, MAX_ERROR_CHARS);
    }
    if (typeof meta.project === "string" && meta.project) context.project = meta.project;
    if (typeof meta.retry === "number") context.retry = meta.retry;
    if (typeof meta.url === "string" && meta.url) context.url = meta.url;
    return context;
}

/**
 * The per-failure prompt asks for "Root cause:" followed by "Line 1/2/3".
 * Line 2 ("what was actually observed") is the useful part; 1 restates the
 * assertion and 3 restates the classification.
 */
export function extractAiNote(content: string): string | undefined {
    const m = content.match(/Root cause:\s*[\s\S]*?Line 2:\s*(.+)/);
    const note = m?.[1].trim();
    return note ? note.slice(0, 280) : undefined;
}

function resolveFailure(aiTxtPath: string): Failure | null {
    const content = fs.readFileSync(aiTxtPath, "utf8");
    const ai = extractTrailingJson(content);

    if (!ai?.failure_type || typeof ai.severity !== "string") return null;
    if (typeof ai.confidence !== "number") return null;

    const meta = readMetaJson(path.join(path.dirname(aiTxtPath), "meta.json"));
    const location = resolveLocation(meta, ai);
    if (!location) return null;

    return {
        ...location,
        failure_type: ai.failure_type,
        severity: ai.severity,
        confidence: ai.confidence,
        is_flaky_suspected:
            ai.is_flaky_suspected ?? meta?.is_flaky_suspected ?? false,
        ...metaContext(meta),
        source: "ai",
        ...(extractAiNote(content) ? { aiNote: extractAiNote(content) } : {}),
    };
}

/** Fallback when AI analysis is disabled or failed: classify from meta.json alone. */
function resolveFailureFromMeta(metaPath: string): Failure | null {
    const meta = readMetaJson(metaPath);
    if (!meta) return null;

    const location = resolveLocation(meta);
    if (!location) return null;

    const failure_type = inferFailureType(meta.errorMessage);

    return {
        ...location,
        failure_type,
        severity: typeof meta.severity === "string" ? meta.severity : "medium",
        confidence: failure_type === "unknown" ? 30 : 60,
        is_flaky_suspected: meta.is_flaky_suspected ?? false,
        ...metaContext(meta),
        source: "heuristic",
    };
}

/**
 * Local runs pile up as artifacts/run-<time>/ folders; globalSetup marks the latest one in
 * artifacts/.current-run. When the marker is there, only that run counts, so a failure fixed
 * since an earlier run isn't reported again. Downloaded CI artifacts don't carry the marker
 * (hidden files aren't uploaded), so a merged artifact from sharded runs is read whole.
 */
export function currentRunDir(root: string): string {
    const marker = path.join(root, ".current-run");
    if (!fs.existsSync(marker)) return root;
    const run = path.join(root, path.basename(fs.readFileSync(marker, "utf8").trim()));
    return run !== root && fs.existsSync(run) ? run : root;
}

function collectFailures(dir: string): Failure[] {
    if (!fs.existsSync(dir)) return [];
    const root = currentRunDir(dir);

    const bestByKey = new Map<string, { failure: Failure; attempt: number }>();

    function consider(failure: Failure | null, filePath: string) {
        if (!failure) return;

        // One record per test: attempts live in <spec>/<test>/attempt-N/, and only the last one
        // counts. Keying attempts by failure type kept a test twice when the attempts were
        // classified differently (e.g. AI on the last attempt, error-text rules on the first).
        const attemptDir = path.dirname(filePath);
        const key = /^attempt-\d+$/.test(path.basename(attemptDir))
            ? `test:${path.dirname(attemptDir)}`
            : failureDiffKey(failure.file, failure.failure_type);
        const attempt = parseAttemptFromAiPath(
            filePath.replace(/meta\.json$/, "ai.txt")
        );
        const existing = bestByKey.get(key);

        if (!existing || attempt >= existing.attempt) {
            bestByKey.set(key, { failure, attempt });
        }
    }

    function walk(dir: string) {
        const entries = fs.readdirSync(dir);
        const hasAiTxt = entries.includes("ai.txt");

        for (const file of entries) {
            const full = path.join(dir, file);

            if (fs.statSync(full).isDirectory()) {
                walk(full);
                continue;
            }

            if (file === "ai.txt") {
                consider(resolveFailure(full), full);
            } else if (file === "meta.json" && !hasAiTxt) {
                consider(resolveFailureFromMeta(full), full);
            }
        }
    }

    walk(root);
    return [...bestByKey.values()].map((entry) => entry.failure);
}

function toMap(arr: Failure[]) {
    const map = new Map<string, Failure>();

    for (const item of arr) {
        const key = failureDiffKey(item.file, item.failure_type);
        map.set(key, item);
    }

    return map;
}

export function computeDiff(
    baselineDir: string,
    currentDir: string
) {
    const baseline = collectFailures(baselineDir);
    const current = collectFailures(currentDir);

    const baselineMap = toMap(baseline);
    const currentMap = toMap(current);

    const newFailures: Failure[] = [];
    const unchangedFailures: Failure[] = [];
    const fixedFailures: Failure[] = [];

    for (const [key, value] of currentMap.entries()) {
        if (!baselineMap.has(key)) newFailures.push(value);
        else unchangedFailures.push(value);
    }

    for (const [key, value] of baselineMap.entries()) {
        if (!currentMap.has(key)) fixedFailures.push(value);
    }

    const blockingFailures = newFailures.filter(
        (f) => !f.is_flaky_suspected
    );

    return {
        newFailures,
        unchangedFailures,
        fixedFailures,
        blockingFailures,
    };
}

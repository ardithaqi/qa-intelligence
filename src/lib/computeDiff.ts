import fs from "fs";
import path from "path";
import {
    failureDiffKey,
    normalizeTestPath,
    parseAttemptFromAiPath,
    parseLocationFromStack,
} from "./failureIdentity";

export interface Failure {
    file: string;
    line: number;
    failure_type: string;
    severity: string;
    confidence: number;
    is_flaky_suspected?: boolean;
}

interface MetaJson {
    stack?: string;
    is_flaky_suspected?: boolean;
    file?: string;
    line?: number;
}

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

function readMetaJson(aiTxtPath: string): MetaJson | null {
    const metaPath = path.join(path.dirname(aiTxtPath), "meta.json");

    if (!fs.existsSync(metaPath)) return null;

    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf8")) as MetaJson;
    } catch {
        return null;
    }
}

function resolveFailure(aiTxtPath: string): Failure | null {
    const content = fs.readFileSync(aiTxtPath, "utf8");
    const ai = extractTrailingJson(content);

    if (!ai?.failure_type || typeof ai.severity !== "string") return null;
    if (typeof ai.confidence !== "number") return null;

    const meta = readMetaJson(aiTxtPath);
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

    const file = normalizeTestPath(
        fromStack?.file ?? fromMeta?.file ?? (typeof ai.file === "string" ? ai.file : "")
    );
    const line =
        fromStack?.line ??
        fromMeta?.line ??
        (typeof ai.line === "number" ? ai.line : Number(ai.line) || 0);

    if (!file) return null;

    return {
        file,
        line,
        failure_type: ai.failure_type,
        severity: ai.severity,
        confidence: ai.confidence,
        is_flaky_suspected:
            ai.is_flaky_suspected ?? meta?.is_flaky_suspected ?? false,
    };
}

function collectFailures(root: string): Failure[] {
    if (!fs.existsSync(root)) return [];

    const bestByKey = new Map<string, { failure: Failure; attempt: number }>();

    function walk(dir: string) {
        for (const file of fs.readdirSync(dir)) {
            const full = path.join(dir, file);

            if (fs.statSync(full).isDirectory()) {
                walk(full);
                continue;
            }

            if (file !== "ai.txt") continue;

            const failure = resolveFailure(full);
            if (!failure) continue;

            const key = failureDiffKey(failure.file, failure.failure_type);
            const attempt = parseAttemptFromAiPath(full);
            const existing = bestByKey.get(key);

            if (!existing || attempt >= existing.attempt) {
                bestByKey.set(key, { failure, attempt });
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

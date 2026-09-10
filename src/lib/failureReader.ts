import fs from "fs";
import path from "path";
import { failureDiffKey, normalizeTestPath } from "./failureIdentity";
import { AiFailure, FailureKey } from "./types";

export type ReadFailuresOptions = {
    rootDir: string; // e.g. artifacts
};

function isDirectory(p: string): boolean {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function walkForAiTxt(dir: string, results: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);

        if (stat.isDirectory()) {
            walkForAiTxt(full, results);
        } else if (entry === "ai.txt" || entry === "failure-meta.json") {
            results.push(full);
        }
    }
    return results;
}

/**
 * Extracts the first balanced {...} object from text, ignoring anything
 * before or after it. Needed because some AI providers (notably Claude)
 * wrap the JSON section in a ```json fence despite being told not to —
 * a naive "first { to end of string" parse breaks on the trailing ```.
 */
function extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * ai.txt contains human section + raw JSON.
 * We extract JSON by finding the first balanced "{...}" object.
 */
function parseAiTxt(filePath: string): AiFailure | null {
    if (filePath.endsWith("failure-meta.json")) {
        try {
            const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

            if (!raw || !Array.isArray(raw.failures) || raw.failures.length === 0) {
                return null;
            }

            const parsed = raw.failures[0];

            return {
                file: parsed.file,
                line: parsed.line,
                failure_type: parsed.failure_type,
                expected: parsed.expected,
                received: parsed.received,
                is_flaky_suspected: Boolean(parsed.is_flaky_suspected),
                severity: parsed.severity,
                confidence: parsed.confidence,
            };
        } catch {
            return null;
        }
    }

    const content = fs.readFileSync(filePath, "utf8");
    const jsonRaw = extractJsonObject(content);
    if (jsonRaw === null) return null;

    try {
        const parsed = JSON.parse(jsonRaw);

        // Minimal validation (avoid hard crash in CI)
        if (
            !parsed ||
            typeof parsed.file !== "string" ||
            (typeof parsed.line !== "number" && typeof parsed.line !== "string") ||
            typeof parsed.failure_type !== "string" ||
            typeof parsed.severity !== "string" ||
            typeof parsed.confidence !== "number"
        ) {
            return null;
        }

        const lineNum =
            typeof parsed.line === "string" ? Number(parsed.line) : parsed.line;

        const failure: AiFailure = {
            file: normalizeTestPath(parsed.file),
            line: Number.isFinite(lineNum) ? lineNum : 0,
            failure_type: parsed.failure_type,
            expected: parsed.expected,
            received: parsed.received,
            is_flaky_suspected: Boolean(parsed.is_flaky_suspected),
            severity: parsed.severity,
            confidence: parsed.confidence,
        };

        return failure;
    } catch {
        return null;
    }
}

export function failureKey(f: AiFailure): FailureKey {
    return failureDiffKey(f.file, f.failure_type);
}

export function readFailures(options: ReadFailuresOptions): {
    failures: AiFailure[];
    byKey: Map<FailureKey, AiFailure>;
    sourceFiles: string[];
} {
    const root = options.rootDir;

    if (!isDirectory(root)) {
        return { failures: [], byKey: new Map(), sourceFiles: [] };
    }

    const aiFiles = walkForAiTxt(root);
    const failures: AiFailure[] = [];
    const byKey = new Map<FailureKey, AiFailure>();

    for (const fp of aiFiles) {
        const parsed = parseAiTxt(fp);
        if (!parsed) continue;

        const key = failureKey(parsed);
        failures.push(parsed);

        // If duplicates, keep the latest encountered (fine for now)
        byKey.set(key, parsed);
    }

    return { failures, byKey, sourceFiles: aiFiles };
}
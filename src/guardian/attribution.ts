import path from "path";
import type { Failure } from "../lib/types";
import type { Attribution, ChangedFile, GuardianConfig } from "./types";

/** Words too generic to link a failing test to a changed file. */
const GENERIC_TOKENS = new Set([
    "src", "lib", "app", "apps", "packages", "components", "component", "pages", "page",
    "index", "utils", "util", "helpers", "helper", "common", "shared", "core", "main",
    "test", "tests", "spec", "specs", "e2e", "playwright", "fixtures", "should", "when",
    "the", "and", "with", "for", "can", "not", "from", "into", "that", "this",
    "html", "http", "https", "www", "com", "localhost", "api", "ts", "tsx", "js", "jsx",
    "json", "css", "scss", "vue", "svelte", "service", "services", "handler", "controller",
    "model", "models", "types", "type", "new", "user", "users", "click", "button", "works",
]);

export const IGNORED_CHANGE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|CHANGELOG\.md|README\.md)$|\.(md|txt|png|jpe?g|svg|gif|lock)$|^\.github\/|^docs\//i;
export const TEST_FILE = /(^|\/)(tests?|e2e|__tests__)\/|\.(spec|test)\.[cm]?[jt]sx?$/i;

/** Splits paths, titles and URLs into lowercase word tokens (camelCase aware). */
export function tokenize(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((t) => t.replace(/s$/, "")) // "sessions" ~ "session"
        .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t));
}

function urlPath(url: string | undefined): string {
    if (!url) return "";
    try {
        return new URL(url).pathname;
    } catch {
        return "";
    }
}

export function failureTokens(failure: Failure): Set<string> {
    return new Set([
        ...tokenize(failure.file.replace(/\.(spec|test)\.[cm]?[jt]sx?$/, "")),
        ...tokenize(failure.title ?? ""),
        ...tokenize(urlPath(failure.url)),
    ]);
}

function matchesKeyword(token: string, keyword: string): boolean {
    const kw = keyword.toLowerCase().replace(/s$/, "");
    return token === kw || (kw.length >= 4 && token.startsWith(kw));
}

/** Area names whose keywords match any of the tokens. */
export function areasForTokens(tokens: Iterable<string>, config: GuardianConfig): string[] {
    const list = [...tokens];
    return Object.entries(config.areas)
        .filter(([, keywords]) => keywords.some((kw) => list.some((t) => matchesKeyword(t, kw))))
        .map(([name]) => name);
}

/**
 * Product area for a failure. Checks the spec path first (strongest signal),
 * then the page URL, then the test title; falls back to the spec name.
 */
export function detectArea(failure: Failure, config: GuardianConfig): string {
    const specName = path.basename(failure.file).replace(/\.(spec|test)\.[cm]?[jt]sx?$/, "");
    const sources = [
        tokenize(failure.file.replace(/\.(spec|test)\.[cm]?[jt]sx?$/, "")),
        tokenize(urlPath(failure.url)),
        tokenize(failure.title ?? ""),
    ];

    for (const tokens of sources) {
        const [area] = areasForTokens(tokens, config);
        if (area) return area;
    }
    return specName;
}

export function isSameTestFile(changedPath: string, failureFile: string): boolean {
    const changed = changedPath.replace(/\\/g, "/");
    return changed === failureFile || changed.endsWith(`/${failureFile}`);
}

function withChange(
    change: ChangedFile,
    kind: Attribution["kind"],
    confidence: number,
    evidence: string
): Attribution {
    return {
        path: change.path,
        kind,
        ...(change.commit ? { commit: change.commit } : {}),
        ...(change.commitSubject ? { commitSubject: change.commitSubject } : {}),
        confidence,
        evidence,
    };
}

function scoreChange(
    failure: Failure,
    tokens: Set<string>,
    failureAreas: string[],
    change: ChangedFile,
    config: GuardianConfig
): Attribution | null {
    const changed = change.path.replace(/\\/g, "/");

    if (isSameTestFile(changed, failure.file)) {
        return withChange(change, "test_file", 50, "The failing test file itself was changed in this PR.");
    }

    if (IGNORED_CHANGE.test(changed) || TEST_FILE.test(changed)) return null;

    const message = failure.errorMessage ?? "";
    if (message && message.includes(changed)) {
        return withChange(change, "error_output", 80, "The changed file path appears in the error output.");
    }

    const changeTokens = new Set(tokenize(changed.replace(/\.[^./]+$/, "")));
    const shared = [...tokens].filter((t) => changeTokens.has(t));
    const sharedArea = areasForTokens(changeTokens, config).find((a) => failureAreas.includes(a));

    if (shared.length === 0 && !sharedArea) return null;

    let confidence = shared.length > 0 ? 35 + 15 * (shared.length - 1) : 25;
    if (sharedArea) confidence += 10;
    confidence = Math.min(70, confidence);

    const evidence = shared.length > 0
        ? `Changed file shares ${shared.map((t) => `"${t}"`).join(", ")} with the failing test's path, title or URL${sharedArea ? ` (both ${sharedArea})` : ""}.`
        : `Changed file and failing test both belong to ${sharedArea}.`;

    return withChange(change, "naming", confidence, evidence);
}

export const MIN_ATTRIBUTION_CONFIDENCE = 35;

/**
 * Most likely changed file for a failure. Heuristic only: E2E stack traces
 * rarely contain application paths, so this leans on naming overlap between
 * the test (path, title, URL) and changed source paths. Returns undefined
 * when nothing clears MIN_ATTRIBUTION_CONFIDENCE.
 */
export function attributeFailure(
    failure: Failure,
    changes: ChangedFile[],
    config: GuardianConfig
): Attribution | undefined {
    const tokens = failureTokens(failure);
    const failureAreas = areasForTokens(tokens, config);
    let best: Attribution | undefined;

    for (const change of changes) {
        const candidate = scoreChange(failure, tokens, failureAreas, change, config);
        if (candidate && (!best || candidate.confidence > best.confidence)) best = candidate;
    }

    return best && best.confidence >= MIN_ATTRIBUTION_CONFIDENCE ? best : undefined;
}

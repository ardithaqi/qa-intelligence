import type { FailureType } from "./types";

/**
 * Deterministic error-message signals shared by the diff engine (when no AI
 * analysis exists) and the release guardian classifier.
 */

export const INFRASTRUCTURE_PATTERN =
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|net::ERR_(?:CONNECTION|NAME_NOT_RESOLVED|INTERNET|NETWORK|TIMED_OUT|ADDRESS)|browserType\.launch|Executable doesn't exist|worker process exited unexpectedly|Target (?:page, context or browser|closed)|\b50[234]\b.*(?:Bad Gateway|Service Unavailable|Gateway Timeout)|socket hang up/i;

export const TEST_ISSUE_PATTERN =
    /strict mode violation|SyntaxError:|ReferenceError:|is not a function|Cannot find module|unknown fixture|fixture "[^"]+" (?:is )?not found|Test (?:file|suite) could not be loaded/i;

const SELECTOR_PATTERN = /element\(s\) not found|resolved to 0 elements|waiting for (?:locator|selector)\b[\s\S]*Timeout/i;
const NAVIGATION_PATTERN = /page\.goto|waiting for navigation|net::ERR_ABORTED|navigation (?:failed|interrupted)/i;
const TIMEOUT_PATTERN = /Timed out \d+ms|Timeout \d+ms exceeded|Test timeout of \d+ms exceeded/i;
const ASSERTION_PATTERN = /expect\(|Expected[\s\S]*Received|AssertionError/;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
    return text.replace(ANSI, "");
}

/** Map a Playwright error message to the same failure_type vocabulary the AI prompt uses. */
export function inferFailureType(errorMessage: string | undefined): FailureType {
    const message = stripAnsi(errorMessage ?? "");
    if (!message.trim()) return "unknown";
    if (INFRASTRUCTURE_PATTERN.test(message)) return "environment_error";
    if (NAVIGATION_PATTERN.test(message)) return "navigation_failure";
    if (SELECTOR_PATTERN.test(message) || /strict mode violation/i.test(message)) {
        return "selector_not_found";
    }
    // "Timed out ... toHaveText" with Expected/Received is a value mismatch, not a hang.
    if (ASSERTION_PATTERN.test(message) && /Received/.test(message)) return "assertion_mismatch";
    if (TIMEOUT_PATTERN.test(message)) return "timeout";
    if (ASSERTION_PATTERN.test(message)) return "assertion_mismatch";
    return "unknown";
}

/**
 * Normalized one-line signature used to group failures with the same error:
 * strips numbers, quoted values and paths so "expected 3, got 4" and
 * "expected 5, got 6" collapse together.
 */
export function errorSignature(errorMessage: string | undefined): string {
    const firstLine =
        stripAnsi(errorMessage ?? "")
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.length > 0) ?? "";

    return firstLine
        .replace(/^Error:\s*/, "")
        .replace(/(["'`]).*?\1/g, "<v>")
        .replace(/https?:\/\/\S+/g, "<url>")
        .replace(/(?:\/[\w.-]+)+/g, "<path>")
        .replace(/\d+/g, "<n>")
        .slice(0, 160);
}

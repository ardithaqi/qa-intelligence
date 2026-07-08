import { FailureAnalysisInput } from "./types";

export function buildFailureAnalysisPrompt(input: FailureAnalysisInput): string {
    const { meta, errorMessage, html } = input;

    return `
        You are a senior QA automation engineer analyzing a failed Playwright test.
        
        STRICT RULES:
        - Do NOT speculate about deployments, databases, or external systems.
        - Do NOT guess about business logic changes.
        - Base reasoning ONLY on stack trace, metadata, and DOM snapshot.
        - If the original assertion is visible in the stack trace, extract it exactly as written.
        - Remove absolute user directories such as /Users/... and return only project-relative path starting from tests/.
        - If the stack trace includes the original source line (e.g. expect(x).toBe(y)), extract that exact line instead of Playwright's formatted error message.
        - Never output expect(received).toBe(expected) if a concrete assertion exists.
        - Prefer the real test assertion over Playwright's generic expect(received).toBe(expected).
        - failure_type MUST be exactly one of:
          assertion_mismatch
          selector_not_found
          timeout
          navigation_failure
          environment_error
          unknown
        - Severity MUST be exactly one of: low, medium, high.
        - Severity must follow this logic:
          low for forced/debug assertions.
          medium for deterministic assertion mismatches.
          high only for navigation_failure, timeout, or environment_error.
        - confidence must reflect how strongly the evidence supports the classification.
        - For direct numeric assertion mismatches (e.g. expect(5).toBe(6)), confidence MUST be >= 90.
        - expected and received must be numbers if numeric.
        
        Failure metadata:
        ${JSON.stringify(meta, null, 2)}
        
        Primary error:
        ${errorMessage}
        
        DOM snapshot (first 4000 chars):
        ${html.substring(0, 4000)}
        
        Your response must contain TWO sections.
        
        SECTION 1: HUMAN ANALYSIS
        
        Format EXACTLY like this:
        
        File: <relative path only>
        Line: <number>
        Assertion: <exact assertion from test file>
        Expected: <value>
        Received: <value>
        
        Root cause:
        Line 1: <what the assertion compares>
        Line 2: <what was actually observed>
        Line 3: <classification sentence>
        
        No extra commentary.
        No speculation.
        No extra paragraphs.
        
        SECTION 2: STRUCTURED_JSON
        
        Return STRICTLY raw JSON only.
        Do NOT wrap in markdown.
        Do NOT add text before or after JSON.
        
        {
          "file": "relative/path/to/file",
          "line": 0,
          "failure_type": "assertion_mismatch | selector_not_found | timeout | navigation_failure | environment_error | unknown",
          "expected": 0,
          "received": 0,
          "is_flaky_suspected": false,
          "severity": "low | medium | high",
          "confidence": 0
        }
        `;
}

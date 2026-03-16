import fs from "fs";
import path from "path";
import OpenAI from "openai";

function getOpenAIClient(): OpenAI | null {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.warn("OPENAI_API_KEY is not set. Skipping AI failure analysis.");
        return null;
    }

    return new OpenAI({ apiKey });
}

function findLatestMetaFile(root = "artifacts"): string | null {
    if (!fs.existsSync(root)) return null;

    let latestPath: string | null = null;
    let latestMtime = -1;

    function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }

            if (entry.name !== "meta.json") continue;

            const stats = fs.statSync(fullPath);
            if (stats.mtimeMs > latestMtime) {
                latestMtime = stats.mtimeMs;
                latestPath = fullPath;
            }
        }
    }

    walk(root);
    return latestPath;
}

export async function analyzeFailureFile(jsonFilePath: string): Promise<string | null> {
    const openai = getOpenAIClient();
    if (!openai) return null;

    const htmlPath = jsonFilePath.replace(".json", ".html");

    const meta = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
    const html = fs.existsSync(htmlPath)
        ? fs.readFileSync(htmlPath, "utf-8")
        : "";

    const prompt = `
        You are a senior QA automation engineer analyzing a failed Playwright test.
        
        STRICT RULES:
        - Do NOT speculate about deployments, databases, or external systems.
        - Do NOT guess about business logic changes.
        - Base reasoning ONLY on stack trace, metadata, and DOM snapshot.
        - If the original assertion is visible in the stack trace, extract it exactly as written.
        - Remove absolute user directories such as /Users/... and return only project-relative path starting from tests/.
        - If the stack trace includes the original source line (e.g. expect(x).toBe(y)), extract that exact line instead of Playwright's formatted error message.
        - Never output expect(received).toBe(expected) if a concrete assertion exists.
        - Prefer the real test assertion over Playwright’s generic expect(received).toBe(expected).
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
        ${meta.errorMessage}
        
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

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content ?? null;

    const usage = response.usage;

    if (usage) {
        console.log("Token usage:", usage);

        // Rough estimate for gpt-4o-mini (adjust if pricing changes)
        const estimatedCost = (usage.total_tokens / 1000) * 0.00015;

        console.log(
            `Estimated cost (approx): $${estimatedCost.toFixed(6)}`
        );
    }

    return content;
}

export async function analyzeLatestFailure(): Promise<string | null> {
    const latestMetaFile = findLatestMetaFile();

    if (!latestMetaFile) {
        console.log("No failure metadata found in artifacts.");
        return null;
    }

    console.log(`Analyzing latest failure: ${latestMetaFile}`);
    return analyzeFailureFile(latestMetaFile);
}

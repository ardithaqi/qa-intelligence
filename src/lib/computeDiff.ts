import fs from "fs";
import path from "path";

export interface Failure {
    file: string;
    line: number;
    failure_type: string;
    severity: string;
    confidence: number;
    is_flaky_suspected?: boolean;
}

function extractTrailingJson(content: string): Failure | null {
    const trimmed = content.trimEnd();

    for (
        let i = trimmed.lastIndexOf("{");
        i >= 0;
        i = trimmed.lastIndexOf("{", i - 1)
    ) {
        try {
            return JSON.parse(trimmed.slice(i)) as Failure;
        } catch { }
    }

    return null;
}

function collectFailures(root: string): Failure[] {
    const failures: Failure[] = [];
    if (!fs.existsSync(root)) return failures;

    function walk(dir: string) {
        for (const file of fs.readdirSync(dir)) {
            const full = path.join(dir, file);

            if (fs.statSync(full).isDirectory()) {
                walk(full);
            } else if (file === "ai.txt") {
                const content = fs.readFileSync(full, "utf8");
                const data = extractTrailingJson(content);
                if (!data) continue;

                failures.push({
                    file: data.file,
                    line: data.line,
                    failure_type: data.failure_type,
                    severity: data.severity,
                    confidence: data.confidence,
                    is_flaky_suspected: data.is_flaky_suspected ?? false
                });
            }
        }
    }

    walk(root);
    return failures;
}

function toMap(arr: Failure[]) {
    const map = new Map<string, Failure>();

    for (const item of arr) {
        const key = `${item.file}:${item.line}:${item.failure_type}`;
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
        blockingFailures
    };
}
import fs from "fs";
import path from "path";

export interface FailureArtifactOptions {
    file: string;
    line: number;
    failure_type: string;
    severity: string;
    confidence: number;
    is_flaky_suspected?: boolean;
    stack?: string;
}

export function writeFailureArtifact(
    root: string,
    specName: string,
    safeTitle: string,
    attempt: number,
    options: FailureArtifactOptions
): string {
    const dir = path.join(root, specName, safeTitle, `attempt-${attempt}`);
    fs.mkdirSync(dir, { recursive: true });

    const aiTxt = [
        "File: " + options.file,
        "Line: " + options.line,
        "",
        JSON.stringify(
            {
                file: options.file,
                line: options.line,
                failure_type: options.failure_type,
                severity: options.severity,
                confidence: options.confidence,
                is_flaky_suspected: options.is_flaky_suspected ?? false,
            },
            null,
            2
        ),
    ].join("\n");

    fs.writeFileSync(path.join(dir, "ai.txt"), aiTxt);

    if (options.stack !== undefined || options.is_flaky_suspected !== undefined) {
        fs.writeFileSync(
            path.join(dir, "meta.json"),
            JSON.stringify(
                {
                    stack: options.stack,
                    is_flaky_suspected: options.is_flaky_suspected ?? false,
                },
                null,
                2
            )
        );
    }

    return path.join(dir, "ai.txt");
}

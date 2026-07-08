#!/usr/bin/env node
import fs from "fs";
import path from "path";

interface ScaffoldEntry {
    template: string;
    dest: string;
}

const PLAYWRIGHT_SCAFFOLD: ScaffoldEntry[] = [
    { template: "playwright/.env.example", dest: "playwright/.env.example" },
    { template: "playwright/.gitignore", dest: "playwright/.gitignore" },
    { template: "playwright/tsconfig.json", dest: "playwright/tsconfig.json" },
    {
        template: "playwright/playwright.config.ts",
        dest: "playwright/playwright.config.ts",
    },
    { template: "playwright/package.json", dest: "playwright/package.json" },
    {
        template: "playwright/tests/example.spec.ts",
        dest: "playwright/tests/example.spec.ts",
    },
];

const CI_SCAFFOLD: ScaffoldEntry[] = [
    {
        template: "github/workflows/qa-intelligence.yml",
        dest: ".github/workflows/qa-intelligence.yml",
    },
];

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function templatesDir(): string {
    return path.join(__dirname, "..", "..", "templates");
}

function copyScaffold(
    root: string,
    entries: ScaffoldEntry[],
    force: boolean
): { written: string[]; skipped: string[] } {
    const written: string[] = [];
    const skipped: string[] = [];
    const sourceRoot = templatesDir();

    for (const { template, dest } of entries) {
        const source = path.join(sourceRoot, template);
        const target = path.join(root, dest);

        if (!fs.existsSync(source)) {
            throw new Error(`Missing template: ${template}`);
        }

        if (fs.existsSync(target) && !force) {
            skipped.push(dest);
            continue;
        }

        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        written.push(dest);
    }

    return { written, skipped };
}

export function runInit(options?: {
    root?: string;
    force?: boolean;
    withCi?: boolean;
}): { written: string[]; skipped: string[] } {
    const root = path.resolve(options?.root ?? process.cwd());
    const force = options?.force ?? false;
    const withCi = options?.withCi ?? true;

    const entries = [...PLAYWRIGHT_SCAFFOLD];
    if (withCi) {
        entries.push(...CI_SCAFFOLD);
    }

    return copyScaffold(root, entries, force);
}

export async function main() {
    const force = hasFlag("force");
    const noCi = hasFlag("no-ci");

    console.log("Scaffolding qa-intelligence in:", process.cwd());

    const { written, skipped } = runInit({
        force,
        withCi: !noCi,
    });

    for (const file of written) {
        console.log(`  created ${file}`);
    }
    for (const file of skipped) {
        console.log(`  skipped ${file} (exists — use --force to overwrite)`);
    }

    if (written.length === 0 && skipped.length > 0) {
        console.log("\nNothing new was written.");
        return;
    }

    console.log("\nNext steps:");
    console.log("  1. cd playwright && cp .env.example .env  # set BASE_URL");
    console.log("  2. cd playwright && npm install");
    console.log("  3. npx playwright install");
    console.log("  4. Add an AI provider API key to GitHub repo secrets (for CI)");
    console.log("     e.g. OPENAI_API_KEY, or ANTHROPIC_API_KEY with AI_PROVIDER=anthropic");
    if (!noCi) {
        console.log("  5. Update BASE_URL in .github/workflows/qa-intelligence.yml");
    }
    console.log("  6. Write tests — import from qa-intelligence/playwright");
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

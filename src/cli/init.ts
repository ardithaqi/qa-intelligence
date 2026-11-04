#!/usr/bin/env node
import fs from "fs";
import path from "path";

interface ScaffoldEntry {
    template: string;
    dest: string;
}

export const PLAYWRIGHT_SCAFFOLD: ScaffoldEntry[] = [
    { template: "playwright/.env.example", dest: "playwright/.env.example" },
    { template: "playwright/gitignore", dest: "playwright/.gitignore" },
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

export const CI_SCAFFOLD: ScaffoldEntry[] = [
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

/** Editor configs that register the MCP server for everyone who opens the repo. */
export const MCP_CONFIG_FILES = [".mcp.json", ".cursor/mcp.json"];
export const MCP_SERVER_NAME = "release-guardian";

/**
 * Runs the locally installed package with node: no download at startup, and
 * no `npx <name>` lookup that could resolve to an unrelated npm package.
 */
export const MCP_SERVER_ENTRY = {
    command: "node",
    args: ["playwright/node_modules/qa-intelligence/dist/cli/guardian.js", "mcp"],
};

/**
 * Adds the release-guardian server to .mcp.json (Claude Code) and
 * .cursor/mcp.json (Cursor), keeping any servers already listed there.
 */
export function writeMcpConfigs(root: string, force: boolean): { written: string[]; skipped: string[] } {
    const written: string[] = [];
    const skipped: string[] = [];

    for (const rel of MCP_CONFIG_FILES) {
        const file = path.join(root, rel);
        let config: { mcpServers?: Record<string, unknown> } = {};
        if (fs.existsSync(file)) {
            try {
                config = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
                skipped.push(`${rel} (not valid JSON, left untouched)`);
                continue;
            }
        }
        const servers = (config.mcpServers ??= {});
        if (servers[MCP_SERVER_NAME] && !force) {
            skipped.push(rel);
            continue;
        }
        servers[MCP_SERVER_NAME] = MCP_SERVER_ENTRY;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
        written.push(rel);
    }
    return { written, skipped };
}

export function runInit(options?: {
    root?: string;
    force?: boolean;
    withCi?: boolean;
    withMcp?: boolean;
}): { written: string[]; skipped: string[] } {
    const root = path.resolve(options?.root ?? process.cwd());
    const force = options?.force ?? false;
    const withCi = options?.withCi ?? true;
    const withMcp = options?.withMcp ?? true;

    const entries = [...PLAYWRIGHT_SCAFFOLD];
    if (withCi) {
        entries.push(...CI_SCAFFOLD);
    }

    const result = copyScaffold(root, entries, force);
    if (withMcp) {
        const mcp = writeMcpConfigs(root, force);
        result.written.push(...mcp.written);
        result.skipped.push(...mcp.skipped);
    }
    return result;
}

export async function main() {
    const force = hasFlag("force");
    const noCi = hasFlag("no-ci");
    const noMcp = hasFlag("no-mcp");

    console.log("Scaffolding AI Release Guardian (qa-intelligence) in:", process.cwd());

    const { written, skipped } = runInit({
        force,
        withCi: !noCi,
        withMcp: !noMcp,
    });

    for (const file of written) {
        console.log(`  created ${file}`);
    }
    for (const file of skipped) {
        console.log(`  skipped ${file} (exists, use --force to overwrite)`);
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
    console.log("  6. Write tests, import from qa-intelligence/playwright");
    if (!noMcp) {
        console.log("\nAI assistants: .mcp.json (Claude Code) and .cursor/mcp.json (Cursor) register the");
        console.log("release-guardian MCP server. Commit them: anyone who opens the repo is asked once to");
        console.log("enable it, then can ask their assistant \"why is my PR blocked?\".");
    }
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";

const EnvSchema = z.object({
    ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
    BASE_URL: z.string().url(),
    HEADLESS: z
        .string()
        .transform((v) => v === "true")
        .default(true),
    PW_WORKERS: z
        .string()
        .transform((v) => Number(v))
        .pipe(z.number().int().positive())
        .default(2),
    PW_RETRIES: z
        .string()
        .transform((v) => Number(v))
        .pipe(z.number().int().nonnegative())
        .default(1),
});

export type Env = z.infer<typeof EnvSchema>;

/** Value of `-c` / `--config` on the Playwright command line, if any. */
export function configArg(argv: string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if ((a === "-c" || a === "--config") && argv[i + 1]) return argv[i + 1];
        if (a.startsWith("--config=")) return a.slice("--config=".length);
    }
    return undefined;
}

/**
 * Where to look for .env, in priority order (first file wins per variable):
 * an explicit RELEASE_GUARDIAN_ENV_FILE, the Playwright config's folder, the
 * current folder, and `playwright/` under it. The last one matters because the
 * VS Code Playwright extension starts from the repo root, while `init`
 * scaffolds everything into `playwright/`.
 */
export function resolveEnvFiles(
    cwd: string = process.cwd(),
    argv: string[] = process.argv,
    vars: NodeJS.ProcessEnv = process.env
): string[] {
    const config = configArg(argv);
    const candidates = [
        vars.RELEASE_GUARDIAN_ENV_FILE ? path.resolve(cwd, vars.RELEASE_GUARDIAN_ENV_FILE) : "",
        config ? path.join(path.dirname(path.resolve(cwd, config)), ".env") : "",
        path.join(cwd, ".env"),
        path.join(cwd, "playwright", ".env"),
    ].filter(Boolean);
    return [...new Set(candidates)].filter((p) => fs.existsSync(p));
}

/**
 * Validates the environment and returns typed settings. Throws a readable
 * error instead of exiting: `process.exit` inside a Playwright config kills
 * the VS Code extension's test server ("test server connection closed").
 */
export function parseEnv(vars: NodeJS.ProcessEnv, looked: string[] = []): Env {
    const parsed = EnvSchema.safeParse(vars);
    if (parsed.success) return parsed.data;

    const problems = Object.entries(parsed.error.flatten().fieldErrors)
        .map(([name, errors]) => `${name}: ${(errors ?? []).join(", ")}`)
        .join("; ");
    const where = looked.length ? `Read .env from: ${looked.join(", ")}.` : "No .env file found.";
    throw new Error(
        `Invalid environment (${problems}). Set the variables in playwright/.env (copy .env.example) or in the shell. ${where}`
    );
}

/** Loads .env files (without overriding variables already set) and validates them. */
export function loadEnv(cwd: string = process.cwd(), argv: string[] = process.argv): Env {
    const files = resolveEnvFiles(cwd, argv);
    if (files.length) dotenv.config({ path: files, quiet: true });
    return parseEnv(process.env, files);
}

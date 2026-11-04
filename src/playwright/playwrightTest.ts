import { createRequire } from "node:module";
import path from "node:path";
import { configArg } from "../config/loadEnv";

/**
 * Where to resolve @playwright/test from, in order. It must be the consumer's
 * copy (the one the runner already loaded), not this package's devDependency,
 * or Playwright fails with "Requiring @playwright/test second time".
 *
 * 1. The running Playwright CLI itself (argv[1]): guarantees the same instance.
 * 2. The Playwright config's folder (`-c path`).
 * 3. The current folder, then `playwright/` under it: the VS Code extension
 *    starts from the repo root while `init` scaffolds into `playwright/`.
 */
export function playwrightSearchBases(argv: string[] = process.argv, cwd: string = process.cwd()): string[] {
    const bases: string[] = [];
    if (argv[1] && /[\\/]playwright(?:-core)?[\\/]|@playwright[\\/]test[\\/]/.test(argv[1])) bases.push(argv[1]);
    const config = configArg(argv);
    if (config) bases.push(path.join(path.dirname(path.resolve(cwd, config)), "package.json"));
    bases.push(path.join(cwd, "package.json"), path.join(cwd, "playwright", "package.json"));
    return [...new Set(bases)];
}

function loadPlaywrightTest(): typeof import("@playwright/test") {
    for (const base of playwrightSearchBases()) {
        try {
            return createRequire(base)("@playwright/test");
        } catch { }
    }
    // Last resort: this package's own resolution (e.g. running inside this repo).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@playwright/test");
}

export const playwrightTest = loadPlaywrightTest();

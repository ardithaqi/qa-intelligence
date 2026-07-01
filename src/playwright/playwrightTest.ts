import { createRequire } from "node:module";
import path from "node:path";

// Resolve @playwright/test from the consumer project (process.cwd()), not from
// this package's node_modules. Required when qa-intelligence is linked via file:
// and the library repo has its own devDependency copy of Playwright.
const requireFromConsumer = createRequire(path.join(process.cwd(), "package.json"));

export const playwrightTest =
  requireFromConsumer("@playwright/test") as typeof import("@playwright/test");

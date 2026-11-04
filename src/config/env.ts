import { loadEnv } from "./loadEnv";

export type { Env } from "./loadEnv";

/** Validated settings for Playwright configs and tests (`qa-intelligence/config/env`). */
export const env = loadEnv();

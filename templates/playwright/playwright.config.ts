import { defineConfig } from "@playwright/test";
import { env } from "qa-intelligence/config/env";

export default defineConfig({
  testDir: "./tests",
  retries: env.PW_RETRIES,
  workers: env.PW_WORKERS,
  globalSetup: require.resolve("qa-intelligence/playwright/globalSetup"),
  globalTeardown: require.resolve("qa-intelligence/playwright/globalTeardown"),
  use: {
    baseURL: env.BASE_URL,
    headless: env.HEADLESS,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  reporter: [["html", { open: "never" }]],
});

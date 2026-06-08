import { test as base } from "@playwright/test";
import fs from "fs";
import { getLogFilePath } from "../reporting/logger";
import path from "path";

export const test = base;

test.afterEach(async ({ page }, testInfo) => {
  const logFile = getLogFilePath();
  if (fs.existsSync(logFile)) {
    await testInfo.attach("run.log", {
      path: logFile,
      contentType: "text/plain",
    });
  }

  const isRealFailure =
    testInfo.status !== testInfo.expectedStatus;

  const isFlaky =
    testInfo.retry > 0 &&
    testInfo.status === testInfo.expectedStatus;

  if (isRealFailure || isFlaky) {
    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach("failure-screenshot", {
      body: screenshot,
      contentType: "image/png",
    });

    const runDir = fs.readFileSync(
      path.join("artifacts", ".current-run"),
      "utf-8"
    );
    const specName = path.basename(testInfo.file);
    const safeTitle = testInfo.title.replace(/[^\w\d]/g, "_");
    const attemptDir = `attempt-${testInfo.retry}`;

    const testDir = path.join(runDir, specName, safeTitle, attemptDir);
    fs.mkdirSync(testDir, { recursive: true });

    const html = await page.content();

    fs.writeFileSync(
      path.join(testDir, "dom.html"),
      html
    );

    const severity = isFlaky ? "low" : "medium";

    const meta = {
      title: testInfo.title,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      errorMessage: testInfo.error?.message,
      stack: testInfo.error?.stack,
      url: page.url(),
      project: testInfo.project.name,
      duration: testInfo.duration,
      retry: testInfo.retry,
      is_flaky_suspected: isFlaky,
      severity: severity
    };

    fs.writeFileSync(
      path.join(testDir, "meta.json"),
      JSON.stringify(meta, null, 2)
    );
  }
});

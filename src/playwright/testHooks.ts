import { playwrightTest } from "./playwrightTest";

const { test: base } = playwrightTest;
import type { Page, TestInfo } from "@playwright/test";
import fs from "fs";
import { getLogFilePath } from "../reporting/logger";
import path from "path";

/** What the page showed when the test ended; missing when there was no page. */
interface PageCapture {
  screenshot?: Buffer;
  html?: string;
  url?: string;
}

const captures = new Map<string, PageCapture>();

const needsRecord = (testInfo: TestInfo) =>
  testInfo.status !== testInfo.expectedStatus || (testInfo.retry > 0 && testInfo.status === testInfo.expectedStatus);

/** Best effort: a closed or crashed page must never stop the failure from being recorded. */
async function capturePage(page: Page): Promise<PageCapture> {
  const capture: PageCapture = {};
  try { capture.url = page.url(); } catch { /* page gone */ }
  try { capture.screenshot = await page.screenshot({ fullPage: true }); } catch { /* page gone */ }
  try { capture.html = await page.content(); } catch { /* page gone */ }
  return capture;
}

/**
 * Records failures (and flaky passes) as artifacts/<run>/<spec>/<test>/attempt-N/meta.json.
 *
 * Two fixtures, not a module-level test.afterEach: a hook registered at import time attaches
 * only to the first spec file that imports this module in each worker, so failures in every
 * later file were silently not recorded. The recorder doesn't depend on `page`, so a failure
 * is recorded even when the browser never started (e.g. a broken browser install); the `page`
 * override adds the screenshot and DOM when there is a page.
 */
export const test = base.extend<{ _qaIntelligenceFailureRecorder: void }>({
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (needsRecord(testInfo)) captures.set(testInfo.testId, await capturePage(page));
  },
  _qaIntelligenceFailureRecorder: [
    async ({}, use, testInfo) => {
      await use();
      const capture = captures.get(testInfo.testId);
      captures.delete(testInfo.testId);
      await recordFailure(testInfo, capture);
    },
    { auto: true },
  ],
});

export async function recordFailure(testInfo: TestInfo, capture: PageCapture = {}): Promise<void> {
  const logFile = getLogFilePath();
  if (fs.existsSync(logFile)) {
    await testInfo.attach("run.log", {
      path: logFile,
      contentType: "text/plain",
    });
  }

  if (!needsRecord(testInfo)) return;
  const isFlaky = testInfo.retry > 0 && testInfo.status === testInfo.expectedStatus;

  if (capture.screenshot) {
    await testInfo.attach("failure-screenshot", {
      body: capture.screenshot,
      contentType: "image/png",
    });
  }

  const runDir = fs.readFileSync(path.join("artifacts", ".current-run"), "utf-8");
  const specName = path.basename(testInfo.file);
  const safeTitle = testInfo.title.replace(/[^\w\d]/g, "_");
  const testDir = path.join(runDir, specName, safeTitle, `attempt-${testInfo.retry}`);
  fs.mkdirSync(testDir, { recursive: true });

  if (capture.html != null) fs.writeFileSync(path.join(testDir, "dom.html"), capture.html);

  let errorMessage = testInfo.error?.message;
  let stack = testInfo.error?.stack;

  if (isFlaky) {
    const prevMetaPath = path.join(runDir, specName, safeTitle, `attempt-${testInfo.retry - 1}`, "meta.json");
    if (fs.existsSync(prevMetaPath)) {
      const prev = JSON.parse(fs.readFileSync(prevMetaPath, "utf8"));
      errorMessage = errorMessage ?? prev.errorMessage;
      stack = stack ?? prev.stack;
    }
  }

  const meta = {
    title: testInfo.title,
    status: testInfo.status,
    expectedStatus: testInfo.expectedStatus,
    file: testInfo.file,
    line: testInfo.line,
    errorMessage,
    stack,
    url: capture.url,
    project: testInfo.project.name,
    duration: testInfo.duration,
    retry: testInfo.retry,
    is_flaky_suspected: isFlaky,
    severity: isFlaky ? "low" : "medium",
  };

  fs.writeFileSync(path.join(testDir, "meta.json"), JSON.stringify(meta, null, 2));
}

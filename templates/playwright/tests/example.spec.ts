import { test, expect } from "qa-intelligence/playwright";

test("example — replace with your first test", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.*/);
});

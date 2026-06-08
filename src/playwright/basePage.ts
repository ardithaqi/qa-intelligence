import { Page } from "@playwright/test";
import { env } from "./baseTest";
import { logger } from "../reporting/logger";

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  protected async navigate(path: string) {
    const url = path.startsWith("http")
      ? path
      : `${env.BASE_URL}${path}`;
  
      logger.info(`Navigating to: ${url}`)
    await this.page.goto(url, { waitUntil: "networkidle" });
    
  }
}
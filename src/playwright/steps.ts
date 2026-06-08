import { test } from "@playwright/test";

export async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return await test.step(name, fn);
}
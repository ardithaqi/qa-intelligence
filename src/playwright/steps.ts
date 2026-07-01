import { playwrightTest } from "./playwrightTest";

const { test } = playwrightTest;

export async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return await test.step(name, fn);
}
import { playwrightTest } from "./playwrightTest";

const { test: base, expect } = playwrightTest;
import { env } from "../config/env";
import "./testHooks";

export const test = base;

export { expect, env };
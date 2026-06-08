import { test as base, expect } from "@playwright/test";
import { env } from "../config/env";
import "./testHooks";

export const test = base;

export { expect, env };
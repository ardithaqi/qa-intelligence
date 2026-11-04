import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Failure } from "../lib/types";
import { attributeFailure, detectArea, tokenize } from "./attribution";
import { DEFAULT_CONFIG } from "./config";

const failure = (over: Partial<Failure> = {}): Failure => ({
    file: "tests/login.spec.ts",
    line: 3,
    failure_type: "assertion_mismatch",
    severity: "medium",
    confidence: 60,
    ...over,
});

describe("tokenize", () => {
    it("splits paths and camelCase, drops generic words and plurals", () => {
        assert.deepEqual(tokenize("src/auth/sessionStore.ts"), ["auth", "session", "store"]);
        assert.deepEqual(tokenize("tests/user-sessions.spec.ts"), ["session"]);
    });
});

describe("detectArea", () => {
    it("maps tests to configured areas via path, title and URL", () => {
        assert.equal(detectArea(failure(), DEFAULT_CONFIG), "Authentication");
        assert.equal(detectArea(failure({ file: "tests/smoke.spec.ts", url: "https://shop.test/checkout/step-2" }), DEFAULT_CONFIG), "Checkout");
        assert.equal(detectArea(failure({ file: "tests/a.spec.ts", title: "applies a coupon at payment" }), DEFAULT_CONFIG), "Payment");
    });

    it("falls back to the spec name", () => {
        assert.equal(detectArea(failure({ file: "tests/dashboard-widgets.spec.ts" }), DEFAULT_CONFIG), "dashboard-widgets");
    });
});

describe("attributeFailure", () => {
    const changes = [
        { path: "src/auth/session.ts", commit: "82fa7d0aaaa", commitSubject: "persist session token" },
        { path: "src/billing/invoice.ts", commit: "bbbbbbb" },
        { path: "README.md" },
        { path: "package-lock.json" },
    ];

    it("picks the changed file sharing words/area with the failing test", () => {
        const a = attributeFailure(failure({ title: "keeps session after reload" }), changes, DEFAULT_CONFIG);
        assert.equal(a?.path, "src/auth/session.ts");
        assert.equal(a?.kind, "naming");
        assert.equal(a?.commit, "82fa7d0aaaa");
        assert.equal(a?.confidence, 45, "one shared word (+35) and same area (+10)");
    });

    it("links by shared area alone (login test → auth file)", () => {
        const a = attributeFailure(failure(), [{ path: "src/auth/guard.ts" }], DEFAULT_CONFIG);
        assert.equal(a?.path, "src/auth/guard.ts");
    });

    it("returns nothing when no change is related", () => {
        assert.equal(attributeFailure(failure({ file: "tests/search.spec.ts" }), changes, DEFAULT_CONFIG), undefined);
    });

    it("ignores docs, lockfiles and other tests", () => {
        const a = attributeFailure(
            failure(),
            [{ path: "README.md" }, { path: "tests/login-helpers.spec.ts" }, { path: "docs/login.md" }],
            DEFAULT_CONFIG
        );
        assert.equal(a, undefined);
    });

    it("detects the failing test file itself changing (repo-root or subfolder paths)", () => {
        const a = attributeFailure(failure(), [{ path: "playwright/tests/login.spec.ts" }], DEFAULT_CONFIG);
        assert.equal(a?.kind, "test_file");
    });

    it("strongest signal: changed path appears in the error output", () => {
        const a = attributeFailure(
            failure({ file: "tests/report.spec.ts", errorMessage: "TypeError at src/lib/formatDate.ts:12" }),
            [{ path: "src/lib/formatDate.ts" }],
            DEFAULT_CONFIG
        );
        assert.equal(a?.kind, "error_output");
        assert.equal(a?.confidence, 80);
    });
});

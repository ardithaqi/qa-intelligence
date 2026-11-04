import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorSignature, inferFailureType } from "./failureSignals";

describe("inferFailureType", () => {
    const cases: [string, string][] = [
        ["page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/", "environment_error"],
        ["browserType.launch: Executable doesn't exist at /ms-playwright/chromium", "environment_error"],
        ["page.goto: Timeout 30000ms exceeded.\nnavigating to \"/x\", waiting until \"load\"", "navigation_failure"],
        ["Timed out 5000ms waiting for expect(locator).toBeVisible()\nExpected: visible\nReceived: <element(s) not found>", "selector_not_found"],
        ["locator.click: Error: strict mode violation: getByRole('button') resolved to 2 elements", "selector_not_found"],
        ["Timed out 5000ms waiting for expect(locator).toHaveText(expected)\nExpected string: \"Hi\"\nReceived string: \"Bye\"", "assertion_mismatch"],
        ["expect(received).toBe(expected) // Object.is equality\n\nExpected: 6\nReceived: 5", "assertion_mismatch"],
        ["Test timeout of 30000ms exceeded.", "timeout"],
        ["Something odd happened", "unknown"],
        ["", "unknown"],
    ];

    for (const [message, expected] of cases) {
        it(`${expected}: ${message.split("\n")[0].slice(0, 50) || "(empty)"}`, () => {
            assert.equal(inferFailureType(message), expected);
        });
    }

    it("ignores ANSI colour codes", () => {
        assert.equal(inferFailureType("\x1b[31mTest timeout of 30000ms exceeded.\x1b[39m"), "timeout");
    });
});

describe("errorSignature", () => {
    it("matches the same error across runs (timeouts, paths, line numbers differ)", () => {
        assert.equal(
            errorSignature("Error: Timed out 300ms waiting for expect(locator).toHaveText(expected)\nExpected: \"dashboard\"\nReceived: \"login\"\nCall log:\n  - waited 12ms"),
            errorSignature("Timed out 5000ms waiting for expect(locator).toHaveText(expected)\nExpected: \"dashboard\"\nReceived: \"login\"\nCall log:\n  - waited 99ms")
        );
        assert.equal(
            errorSignature("TypeError: x is undefined at /home/a/src/app.ts:10:5"),
            errorSignature("TypeError: x is undefined at /Users/b/src/app.ts:44:2")
        );
    });

    it("keeps different expected/received values apart", () => {
        assert.notEqual(
            errorSignature("Timed out 300ms waiting for expect(locator).toHaveText(expected)\nExpected: \"cart-1\"\nReceived: \"0\""),
            errorSignature("Timed out 300ms waiting for expect(locator).toHaveText(expected)\nExpected: \"orders-3\"\nReceived: \"2\"")
        );
        assert.notEqual(errorSignature("Expected 3 rows"), errorSignature("Timeout 3ms exceeded"));
    });
});

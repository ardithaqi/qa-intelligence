import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
    parseAttemptFromMetaPath,
    selectMetaFilesForAnalysis,
    testKeyFromMetaPath,
} from "./selectMetaForAnalysis";

const RUN = path.join("artifacts", "run-1", "login.spec.ts", "user_login");

function meta(attempt: number): string {
    return path.join(RUN, `attempt-${attempt}`, "meta.json");
}

describe("selectMetaFilesForAnalysis", () => {
    it("keeps only the highest failed attempt per test", () => {
        const metas = new Map([
            [meta(0), { is_flaky_suspected: false }],
            [meta(1), { is_flaky_suspected: false }],
        ]);

        const selected = selectMetaFilesForAnalysis(
            [meta(0), meta(1)],
            (p) => metas.get(p) ?? null
        );

        assert.deepEqual(selected, [meta(1)]);
    });

    it("prefers the flaky pass attempt over earlier failures", () => {
        const metas = new Map([
            [meta(0), { is_flaky_suspected: false }],
            [meta(1), { is_flaky_suspected: true }],
        ]);

        const selected = selectMetaFilesForAnalysis(
            [meta(0), meta(1)],
            (p) => metas.get(p) ?? null
        );

        assert.deepEqual(selected, [meta(1)]);
    });

    it("selects one meta per distinct test", () => {
        const other = path.join("artifacts", "run-1", "login.spec.ts", "logout", "attempt-0", "meta.json");
        const metas = new Map([
            [meta(0), { is_flaky_suspected: false }],
            [other, { is_flaky_suspected: false }],
        ]);

        const selected = selectMetaFilesForAnalysis(
            [meta(0), other],
            (p) => metas.get(p) ?? null
        );

        assert.equal(selected.length, 2);
    });
});

describe("parseAttemptFromMetaPath", () => {
    it("reads attempt number from meta path", () => {
        assert.equal(parseAttemptFromMetaPath(meta(2)), 2);
    });
});

describe("testKeyFromMetaPath", () => {
    it("groups attempts under the same test title", () => {
        assert.equal(testKeyFromMetaPath(meta(0)), RUN);
        assert.equal(testKeyFromMetaPath(meta(1)), RUN);
    });
});

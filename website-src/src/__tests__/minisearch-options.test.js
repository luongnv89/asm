import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MINISEARCH_OPTIONS } from "../lib/minisearch-options.js";

/**
 * Guard against drift between the build-time MiniSearch options
 * (`scripts/minisearch-options.ts`) and the runtime copy used by the
 * React frontend. If the two disagree, the serialized index deserializes
 * with mismatched tokenization and search ranking silently corrupts.
 *
 * We parse the TS source with a lightweight regex rather than importing
 * it — tsx is the only TS runtime in this project and vitest runs on
 * node + esbuild's JSX transform, not on tsx. Regex parsing keeps the
 * test independent of the tooling choice.
 */
describe("minisearch options parity", () => {
  it("matches the TypeScript source used by the build script", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../scripts/minisearch-options.ts"),
      "utf8",
    );

    // Extract the object literal after `MINISEARCH_OPTIONS = { ... };`
    // and coerce it into JSON the loose way — the test covers structural
    // fields (idField, fields, boost, prefix, fuzzy).
    expect(src).toContain('idField: "id"');
    expect(MINISEARCH_OPTIONS.idField).toBe("id");

    // Fields array ordering matters — MiniSearch keys on positional
    // order during deserialization.
    expect(src).toContain('fields: ["name", "description", "categoriesStr"]');
    expect(MINISEARCH_OPTIONS.fields).toEqual([
      "name",
      "description",
      "categoriesStr",
    ]);

    expect(src).toContain("prefix: true");
    expect(MINISEARCH_OPTIONS.searchOptions.prefix).toBe(true);

    expect(src).toContain("fuzzy: 0.2");
    expect(MINISEARCH_OPTIONS.searchOptions.fuzzy).toBe(0.2);

    expect(src).toContain(
      "boost: { name: 3, description: 1, categoriesStr: 1 }",
    );
    expect(MINISEARCH_OPTIONS.searchOptions.boost).toEqual({
      name: 3,
      description: 1,
      categoriesStr: 1,
    });
  });
});

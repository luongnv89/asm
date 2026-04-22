/**
 * MiniSearch runtime options — MUST stay in sync with
 * `scripts/minisearch-options.ts` so the serialized index deserializes
 * correctly. The build script is the source of truth; this is a JS copy
 * for the React runtime (no TypeScript imports at runtime).
 *
 * The unit test `src/__tests__/minisearch-options.test.js` asserts this
 * object matches the TS source by structural comparison.
 */
export const MINISEARCH_OPTIONS = {
  idField: "id",
  fields: ["name", "description", "categoriesStr"],
  storeFields: [],
  searchOptions: {
    boost: { name: 3, description: 1, categoriesStr: 1 },
    prefix: true,
    fuzzy: 0.2,
  },
};

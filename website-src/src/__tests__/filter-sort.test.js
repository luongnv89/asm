import { describe, expect, it } from "vitest";
import {
  applyFilters,
  anyFilterActive,
  buildNameCollisionKeys,
  defaultSort,
} from "../lib/filter-sort.js";
import { emptyFacetState } from "../lib/facets.js";

const mk = (p) => ({
  id: p.id,
  name: p.name || p.id,
  description: p.description || "",
  owner: p.owner || "anon",
  repo: p.repo || "repo",
  categories: p.categories || ["general"],
  license: p.license || "",
  verified: !!p.verified,
  hasTools: !!p.hasTools,
  tokenCount: p.tokenCount,
  evalSummary: p.evalSummary,
  featured: !!p.featured,
  allowedTools: p.allowedTools,
});

const base = () => ({
  searchQuery: "",
  activeCategories: new Set(),
  activeRepo: "all",
  activeFacets: emptyFacetState(),
  sort: null,
  page: 1,
});

describe("applyFilters", () => {
  it("returns all when no filters active and sorts by name", () => {
    const skills = [
      mk({ id: "b", name: "beta" }),
      mk({ id: "a", name: "alpha" }),
    ];
    const out = applyFilters(skills, base());
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("pins featured skills above others", () => {
    const skills = [
      mk({ id: "b", name: "beta" }),
      mk({ id: "a", name: "alpha", featured: true }),
    ];
    const out = applyFilters(skills, base());
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("filters by category (multi-select ANY-match)", () => {
    const skills = [
      mk({ id: "x", categories: ["foo"] }),
      mk({ id: "y", categories: ["bar"] }),
      mk({ id: "z", categories: ["foo", "baz"] }),
    ];
    const state = { ...base(), activeCategories: new Set(["foo"]) };
    const out = applyFilters(skills, state);
    expect(out.map((s) => s.id).sort()).toEqual(["x", "z"]);
  });

  it("filters by repo", () => {
    const skills = [
      mk({ id: "x", owner: "a", repo: "r1" }),
      mk({ id: "y", owner: "b", repo: "r2" }),
    ];
    const state = { ...base(), activeRepo: "a/r1" };
    expect(applyFilters(skills, state).map((s) => s.id)).toEqual(["x"]);
  });

  it("filters by license bucket", () => {
    const skills = [
      mk({ id: "mit1", license: "MIT" }),
      mk({ id: "ap1", license: "Apache-2.0" }),
    ];
    const state = base();
    state.activeFacets.license.add("MIT");
    expect(applyFilters(skills, state).map((s) => s.id)).toEqual(["mit1"]);
  });

  it("filters by grade", () => {
    const skills = [
      mk({ id: "a", evalSummary: { grade: "A", overallScore: 92 } }),
      mk({ id: "c", evalSummary: { grade: "C", overallScore: 65 } }),
    ];
    const state = base();
    state.activeFacets.grade.add("A");
    expect(applyFilters(skills, state).map((s) => s.id)).toEqual(["a"]);
  });

  it("filters by source: official/verified/community", () => {
    const skills = [
      mk({ id: "o", owner: "anthropics" }),
      mk({ id: "v", owner: "other", verified: true }),
      mk({ id: "c", owner: "x", verified: false }),
    ];
    const state = base();
    state.activeFacets.source.add("official");
    expect(applyFilters(skills, state).map((s) => s.id)).toEqual(["o"]);
  });

  it("filters by tool use", () => {
    const skills = [
      mk({ id: "y", hasTools: true }),
      mk({ id: "n", hasTools: false }),
    ];
    const state = base();
    state.activeFacets.usesTools.add("yes");
    expect(applyFilters(skills, state).map((s) => s.id)).toEqual(["y"]);
  });

  it("sort: grade — best grade first, tiebreak by score desc then name", () => {
    const skills = [
      mk({ id: "b", name: "b", evalSummary: { grade: "B", overallScore: 81 } }),
      mk({ id: "a", name: "a", evalSummary: { grade: "A", overallScore: 90 } }),
      mk({ id: "c", name: "c", evalSummary: { grade: "A", overallScore: 95 } }),
    ];
    const out = applyFilters(skills, { ...base(), sort: "grade" });
    expect(out.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("sort: tokens-asc / tokens-desc", () => {
    const skills = [
      mk({ id: "hi", tokenCount: 10000 }),
      mk({ id: "lo", tokenCount: 100 }),
    ];
    expect(
      applyFilters(skills, { ...base(), sort: "tokens-asc" }).map((s) => s.id),
    ).toEqual(["lo", "hi"]);
    expect(
      applyFilters(skills, { ...base(), sort: "tokens-desc" }).map((s) => s.id),
    ).toEqual(["hi", "lo"]);
  });

  it("uses search scores when scoreById is provided", () => {
    const skills = [
      mk({ id: "alpha" }),
      mk({ id: "beta" }),
      mk({ id: "gamma" }),
    ];
    const state = { ...base(), searchQuery: "foo", sort: "relevance" };
    const scoreById = new Map([
      ["beta", 5],
      ["gamma", 10],
    ]);
    const out = applyFilters(skills, state, { scoreById });
    expect(out.map((s) => s.id)).toEqual(["gamma", "beta"]);
  });
});

describe("buildNameCollisionKeys (issue #241)", () => {
  it("returns an empty set when every (owner, repo, name) is unique", () => {
    const skills = [
      mk({ id: "1", name: "a", owner: "o", repo: "r1" }),
      mk({ id: "2", name: "a", owner: "o", repo: "r2" }),
      mk({ id: "3", name: "b", owner: "o", repo: "r1" }),
    ];
    expect(buildNameCollisionKeys(skills).size).toBe(0);
  });

  it("flags only the (owner, repo, name) tuples that collide", () => {
    const skills = [
      // Two entries sharing owner/repo/name — a plugin-bundle variant
      mk({ id: "1", name: "dup", owner: "o", repo: "r" }),
      mk({ id: "2", name: "dup", owner: "o", repo: "r" }),
      // Same name under a different repo — NOT a collision
      mk({ id: "3", name: "dup", owner: "o", repo: "other" }),
      // Unrelated unique entry
      mk({ id: "4", name: "solo", owner: "o", repo: "r" }),
    ];
    const keys = buildNameCollisionKeys(skills);
    expect(keys.has("o/r::dup")).toBe(true);
    expect(keys.has("o/other::dup")).toBe(false);
    expect(keys.has("o/r::solo")).toBe(false);
    expect(keys.size).toBe(1);
  });

  it("handles the reported sickn33 case (3 install paths, same skill)", () => {
    const skills = [
      mk({
        id: "a",
        name: "00-andruia-consultant",
        owner: "sickn33",
        repo: "antigravity-awesome-skills",
      }),
      mk({
        id: "b",
        name: "00-andruia-consultant",
        owner: "sickn33",
        repo: "antigravity-awesome-skills",
      }),
      mk({
        id: "c",
        name: "00-andruia-consultant",
        owner: "sickn33",
        repo: "antigravity-awesome-skills",
      }),
    ];
    const keys = buildNameCollisionKeys(skills);
    expect(keys.size).toBe(1);
    expect(
      keys.has("sickn33/antigravity-awesome-skills::00-andruia-consultant"),
    ).toBe(true);
  });

  it("returns a fresh Set (not a shared reference)", () => {
    const skills = [mk({ id: "1", name: "x" })];
    expect(buildNameCollisionKeys(skills)).not.toBe(
      buildNameCollisionKeys(skills),
    );
  });
});

describe("anyFilterActive", () => {
  it("returns true when search is non-empty", () => {
    expect(anyFilterActive({ ...base(), searchQuery: "x" })).toBe(true);
  });
  it("returns false when state is clean", () => {
    expect(anyFilterActive(base())).toBe(false);
  });
});

describe("defaultSort", () => {
  it("is relevance when search active, name otherwise", () => {
    expect(defaultSort("")).toBe("name");
    expect(defaultSort("foo")).toBe("relevance");
  });
});

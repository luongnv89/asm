import { licenseBucket, skillSource } from "./utils.js";

/**
 * Facet definitions — ported from `website/index.html`. Each facet is a
 * multi-select ANY-match filter. Display order is curated; values not in
 * `order` are appended at the end of a group.
 */
export const FACET_DEFS = [
  {
    key: "source",
    label: "Source",
    order: ["official", "verified", "community"],
  },
  { key: "grade", label: "Grade", order: ["A", "B", "C", "D", "F"] },
  {
    key: "license",
    label: "License",
    order: [
      "MIT",
      "Apache-2.0",
      "BSD",
      "GPL",
      "CC",
      "CeCILL",
      "Other",
      "Unknown",
    ],
  },
  {
    key: "usesTools",
    label: "Tools",
    order: ["yes", "no"],
    display: { yes: "uses tools", no: "no tools" },
  },
];

export function emptyFacetState() {
  return {
    license: new Set(),
    grade: new Set(),
    source: new Set(),
    usesTools: new Set(),
  };
}

export function computeFacetCounts(skills) {
  const out = {
    license: {},
    grade: {},
    source: {},
    usesTools: { yes: 0, no: 0 },
  };
  for (const s of skills) {
    const lb = licenseBucket(s.license);
    out.license[lb] = (out.license[lb] || 0) + 1;
    if (s.evalSummary && s.evalSummary.grade) {
      out.grade[s.evalSummary.grade] =
        (out.grade[s.evalSummary.grade] || 0) + 1;
    }
    const src = skillSource(s);
    out.source[src] = (out.source[src] || 0) + 1;
    const yes =
      s.hasTools === true || !!(s.allowedTools && s.allowedTools.length > 0);
    out.usesTools[yes ? "yes" : "no"]++;
  }
  return out;
}

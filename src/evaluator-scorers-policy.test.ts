import { describe, it, expect } from "vitest";
import {
  scoreSafety,
  scoreTestability,
  scoreNaming,
  scoreLicense,
  isPrivateLicense,
  parseSpdxExpression,
  MAX_SPDX_NESTING,
} from "./evaluator-scorers-policy";
import { SAFE_BODY, TESTABLE_BODY } from "./evaluator-test-fixtures";
describe("scoreSafety", () => {
  it("awards the full 10 points when destructive actions are paired with a confirmation", () => {
    const result = scoreSafety({}, SAFE_BODY);
    expect(result.id).toBe("safety");
    expect(result.score).toBe(10);
    expect(result.findings).toContain(
      "Destructive actions paired with confirmation/dry-run.",
    );
    expect(result.findings).toContain(
      "Declares prerequisites or requirements.",
    );
  });

  it("credits only half the destructive bucket when nothing destructive is mentioned", () => {
    const result = scoreSafety({}, SAFE_BODY.replace("delete", "archive"));
    expect(result.score).toBe(9);
    expect(result.findings).not.toContain(
      "Destructive actions paired with confirmation/dry-run.",
    );
  });

  it("scores a single safety cue with no prerequisites at 3", () => {
    const result = scoreSafety({}, "Run the check.");
    expect(result.score).toBe(3);
    expect(result.findings).toContain(
      "No prerequisites / requirements section.",
    );
    expect(
      result.suggestions.some((s) => s.includes("Expand the safety section")),
    ).toBe(true);
    expect(
      result.suggestions.some((s) =>
        s.includes('Add a "## Prerequisites" block'),
      ),
    ).toBe(true);
  });
});

describe("scoreTestability", () => {
  it("awards the full 10 points for acceptance criteria, expected output and edge cases", () => {
    const result = scoreTestability({}, TESTABLE_BODY);
    expect(result.id).toBe("testability");
    expect(result.score).toBe(10);
    expect(result.findings).toContain("Describes expected output/result.");
    expect(result.findings).toContain("Mentions edge cases or limitations.");
  });

  it("gives 3 points for a couple of cues and asks for acceptance criteria", () => {
    const result = scoreTestability({}, "Run the tests and verify the report.");
    expect(result.score).toBe(3);
    expect(result.findings).toContain(
      "Some testability cues: test, tests, verify.",
    );
    expect(
      result.suggestions.some((s) =>
        s.includes('Add an "## Acceptance Criteria" block'),
      ),
    ).toBe(true);
  });

  it("scores 0 and asks for a testable section when no cue is present", () => {
    const result = scoreTestability({}, "Do the thing.");
    expect(result.score).toBe(0);
    expect(
      result.suggestions.some((s) =>
        s.includes('Add a "## Acceptance Criteria" section'),
      ),
    ).toBe(true);
    expect(
      result.suggestions.some((s) =>
        s.includes('Include an "Expected output"'),
      ),
    ).toBe(true);
    expect(
      result.suggestions.some((s) =>
        s.includes('Add a short "Edge cases" list'),
      ),
    ).toBe(true);
  });
});

describe("scoreNaming", () => {
  it("caps at 9 of 10 because the basename point is scored by the aggregator", () => {
    const result = scoreNaming(
      { name: "code-review", description: "Review diffs for smells." },
      "# Code review\n\n## Instructions\n\n## Examples\n",
    );
    expect(result.id).toBe("naming");
    expect(result.max).toBe(10);
    expect(result.score).toBe(9);
    expect(result.findings).toContain(
      'name "code-review" follows kebab-case convention.',
    );
    expect(result.findings).toContain(
      "Most headings use action/imperative labels.",
    );
  });

  it("skips the heading bucket entirely when the body has no headings", () => {
    const result = scoreNaming(
      { name: "code-review", description: "Review diffs for smells." },
      "no headings here",
    );
    expect(result.score).toBe(6);
    expect(result.findings).not.toContain(
      "Most headings use action/imperative labels.",
    );
  });

  it("gives 1 point when fewer than half the headings are action labels", () => {
    const result = scoreNaming(
      { name: "code-review", description: "Review diffs for smells." },
      "# lowercase thing\n\n## another lowercase\n",
    );
    expect(result.score).toBe(7);
    expect(
      result.suggestions.some((s) =>
        s.includes("Rename body headings to action-oriented labels"),
      ),
    ).toBe(true);
  });

  it("reports over-long names and drops the naming bucket", () => {
    const longName = "a-very-long-skill-name-that-keeps-on-going-forever";
    const result = scoreNaming(
      { name: longName, description: "Review diffs for smells." },
      "# Code review\n\n## Instructions\n",
    );
    expect(result.score).toBe(5);
    expect(result.findings).toContain(
      `name is ${longName.length} chars; keep it <= 40.`,
    );
  });

  it("withholds the clean-label point for noisy descriptions", () => {
    const result = scoreNaming(
      { name: "code-review", description: "TODO  write this" },
      "# Code review\n\n## Instructions\n",
    );
    expect(result.score).toBe(7);
    expect(
      result.suggestions.some((s) => s.includes("Clean up description")),
    ).toBe(true);
  });

  it("asks for a name when frontmatter has none", () => {
    const result = scoreNaming(
      { description: "Review diffs for smells." },
      "# Code review\n\n## Instructions\n",
    );
    expect(
      result.suggestions.some((s) =>
        s.includes("Add a kebab-case `name` (e.g. `my-skill`)"),
      ),
    ).toBe(true);
  });
});

describe("scoreLicense (#771)", () => {
  const lic = (license?: string): Record<string, string> =>
    license ? { license } : {};
  const NO_OWN_FILE = ["SKILL.md"];

  it("scores 10 for a recognised SPDX licence with its own LICENSE file", () => {
    const r = scoreLicense(lic("MIT"), "", ["SKILL.md", "LICENSE"]);
    expect(r.score).toBe(10);
    expect(r.findings).toContain("LICENSE file present at skill root.");
  });

  it("recognises COPYING as the skill's own licence file", () => {
    const r = scoreLicense(lic("GPL-3.0-only"), "", ["SKILL.md", "COPYING"]);
    expect(r.score).toBe(10);
  });

  it("scores 10 for a recognised SPDX licence inherited from the repo root", () => {
    const r = scoreLicense(lic("MIT"), "", NO_OWN_FILE, "../../LICENSE");
    expect(r.score).toBe(10);
    expect(r.licenseStatus).toBe("recognised");
    expect(r.findings).toContain(
      "LICENSE inherited from the enclosing repository (`../../LICENSE`).",
    );
    expect(r.findings.join("\n")).not.toMatch(/No LICENSE file found/);
    expect(r.suggestions).toEqual([]);
  });

  it("prefers the skill's own LICENSE file over an inherited one", () => {
    const r = scoreLicense(
      lic("MIT"),
      "",
      ["SKILL.md", "LICENSE.md"],
      "../../LICENSE",
    );
    expect(r.score).toBe(10);
    expect(r.findings).toContain("LICENSE file present at skill root.");
    expect(r.findings.join("\n")).not.toMatch(/inherited/);
  });

  it("keeps 5 for a recognised SPDX licence with no licence file anywhere", () => {
    const r = scoreLicense(lic("MIT"), "", NO_OWN_FILE);
    expect(r.score).toBe(5);
    expect(r.findings).toContain(
      "No LICENSE file found — consider adding one for clarity.",
    );
  });

  it.each([
    "Proprietary",
    "proprietary",
    "Proprietary-1.0",
    "UNLICENSED",
    "SEE LICENSE IN LICENSE.md",
    "See license in ./terms.txt",
    "private",
    "Private",
    "All rights reserved",
    "Copyright 2026 Acme Corp. All rights reserved.",
  ])("scores a private licence `%s` >= 8 without a licence file", (id) => {
    const r = scoreLicense(lic(id), "", NO_OWN_FILE);
    expect(r.score).toBe(8);
    expect(r.licenseStatus).toBe("private");
    expect(r.findings).toContain(
      `Private licence declared: \`${id}\` — no SPDX identifier or LICENSE file required.`,
    );
    expect(r.findings.join("\n")).not.toMatch(/SPDX list/);
    expect(r.suggestions).toEqual([]);
  });

  it("scores a private licence 10 when a licence file backs it", () => {
    expect(scoreLicense(lic("Proprietary"), "", ["LICENSE"]).score).toBe(10);
    expect(
      scoreLicense(lic("UNLICENSED"), "", NO_OWN_FILE, "../LICENSE.txt").score,
    ).toBe(10);
  });

  it("keeps 2 for a declared licence that is neither SPDX nor private", () => {
    const r = scoreLicense(lic("Foo-Public-1.0"), "", NO_OWN_FILE);
    expect(r.score).toBe(2);
    expect(r.licenseStatus).toBe("unrecognised");
    expect(r.findings).toContain(
      "License declared as `Foo-Public-1.0` but not in asm's list of recognised SPDX identifiers.",
    );
  });

  it("keeps 0 when no licence is declared, even with an inherited LICENSE", () => {
    const r = scoreLicense(lic(), "", NO_OWN_FILE, "../../LICENSE");
    expect(r.score).toBe(0);
    expect(r.licenseStatus).toBe("missing");
    expect(r.findings).toContain("No license declared.");
  });

  it("isPrivateLicense does not treat the SPDX `Unlicense` as private", () => {
    expect(isPrivateLicense("Unlicense")).toBe(false);
    expect(isPrivateLicense("UNLICENSED")).toBe(true);
    expect(isPrivateLicense("MIT")).toBe(false);
  });
});

describe("parseSpdxExpression (#783)", () => {
  it("parses OR, AND, WITH, parentheses and the `+` suffix", () => {
    const r = parseSpdxExpression(
      "(MIT AND BSD-2-Clause) OR Apache-2.0 WITH LLVM-exception OR GPL-2.0+",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.leaves.map((l) => [l.id, l.kind])).toEqual([
      ["MIT", "spdx"],
      ["BSD-2-Clause", "spdx"],
      ["Apache-2.0", "spdx"],
      ["GPL-2.0", "spdx"],
    ]);
    expect(r.exceptions).toEqual([{ id: "LLVM-exception", known: true }]);
    expect(r.deprecated).toEqual([{ id: "GPL-2.0", orLater: true }]);
  });

  it("accepts nesting up to MAX_SPDX_NESTING", () => {
    const v = `${"(".repeat(MAX_SPDX_NESTING)}MIT${")".repeat(MAX_SPDX_NESTING)}`;
    expect(parseSpdxExpression(v).ok).toBe(true);
  });

  it("matches identifiers and exceptions in any case (SPDX 2.3 D.2)", () => {
    const r = parseSpdxExpression("mit OR apache-2.0 WITH llvm-EXCEPTION");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.leaves.every((l) => l.kind === "spdx")).toBe(true);
    expect(r.exceptions[0].known).toBe(true);
  });

  it("classifies LicenseRef, private and unknown leaves", () => {
    const r = parseSpdxExpression(
      "LicenseRef-Acme OR DocumentRef-spdx-1.2:LicenseRef-X OR Proprietary OR Foo-1.0",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.leaves.map((l) => l.kind)).toEqual([
      "ref",
      "ref",
      "private",
      "unknown",
    ]);
  });

  it.each([
    ["", "empty"],
    ["MIT OR", "expected a licence identifier after `OR`"],
    ["OR MIT", "expected a licence identifier but found `OR`"],
    ["(MIT", "expected `)`"],
    ["MIT)", "unexpected `)`"],
    ["MIT Apache-2.0", "unexpected `Apache-2.0`"],
    ["MIT or Apache-2.0", "unexpected `or`"],
    ["MIT +", "unexpected `+`"],
    ["LicenseRef-Acme+", "`+` may follow only a licence identifier"],
    ["(MIT OR ISC) WITH LLVM-exception", "WITH must follow a single"],
    ["Apache-2.0 WITH", "expected a licence exception after `WITH`"],
    ["MIT_2", "not a valid licence identifier"],
    [
      `${"(".repeat(65)}MIT${")".repeat(65)}`,
      "parentheses nested more than 64 deep",
    ],
  ])("rejects invalid syntax `%s`", (input, error) => {
    const r = parseSpdxExpression(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(error);
  });
});

describe("scoreLicense with SPDX expressions (#783)", () => {
  const lic = (license: string): Record<string, string> => ({ license });
  const NO_OWN_FILE = ["SKILL.md"];
  const OWN_FILE = ["SKILL.md", "LICENSE"];
  const INHERITED = "../../LICENSE";

  it.each([
    "MIT OR Apache-2.0",
    "(MIT AND BSD-2-Clause)",
    "Apache-2.0 WITH LLVM-exception",
    "GPL-2.0+",
    "mit",
    "(GPL-2.0-or-later WITH Classpath-exception-2.0) OR MIT",
    "LicenseRef-Acme-1.0",
  ])("scores `%s` 10 with an own or inherited LICENSE, 5 without", (v) => {
    const own = scoreLicense(lic(v), "", OWN_FILE);
    expect(own.score).toBe(10);
    expect(own.licenseStatus).toBe("recognised");
    expect(scoreLicense(lic(v), "", NO_OWN_FILE, INHERITED).score).toBe(10);
    expect(scoreLicense(lic(v), "", NO_OWN_FILE).score).toBe(5);
  });

  it("names a valid expression in the finding", () => {
    const r = scoreLicense(lic("MIT OR Apache-2.0"), "", OWN_FILE);
    expect(r.findings).toContain(
      "License declared: `MIT OR Apache-2.0` (valid SPDX license expression, every identifier recognised).",
    );
    expect(r.suggestions).toEqual([]);
  });

  it("says a LicenseRef's text belongs in the licence file", () => {
    const r = scoreLicense(lic("LicenseRef-Acme-1.0"), "", NO_OWN_FILE);
    expect(r.findings.join("\n")).toMatch(
      /custom reference `LicenseRef-Acme-1\.0`.*licence file/i,
    );
  });

  it("suggests the current identifier for a deprecated one", () => {
    const r = scoreLicense(lic("GPL-2.0+"), "", OWN_FILE);
    expect(r.score).toBe(10);
    expect(r.suggestions).toEqual([
      "`GPL-2.0+` is deprecated on the SPDX License List — use `GPL-2.0-or-later`.",
    ]);
    expect(scoreLicense(lic("GPL-3.0"), "", OWN_FILE).suggestions).toEqual([
      "`GPL-3.0` is deprecated on the SPDX License List — use `GPL-3.0-only` or `GPL-3.0-or-later`.",
    ]);
  });

  it.each([
    ["5000 nested parentheses", `${"(".repeat(5000)}MIT${")".repeat(5000)}`],
    ["a 100 KB nested value", `${"(".repeat(50_000)}MIT${")".repeat(50_000)}`],
  ])("scores %s 2 without throwing", (_label, v) => {
    const r = scoreLicense(lic(v), "", OWN_FILE);
    expect(r.score).toBe(2);
    expect(r.licenseStatus).toBe("unrecognised");
    expect(r.findings[0]).toMatch(
      /not a valid SPDX license expression: parentheses nested more than 64 deep\.$/,
    );
  });

  it("handles a 100 KB flat expression without throwing", () => {
    const v = Array(15_000).fill("MIT").join(" OR ");
    expect(v.length).toBeGreaterThan(100_000);
    expect(scoreLicense(lic(v), "", OWN_FILE).score).toBe(10);
  });

  it.each([
    [
      "MIT OR Foo-1.0",
      "but `Foo-1.0` is not in asm's list of recognised SPDX identifiers.",
    ],
    [
      "Apache-2.0 WITH Foo-exception",
      "but `Foo-exception` is not in asm's list of recognised SPDX exceptions.",
    ],
    [
      "MIT OR",
      "but it is not a valid SPDX license expression: expected a licence identifier after `OR`.",
    ],
    [
      "MIT or Apache-2.0",
      "but it is not a valid SPDX license expression: unexpected `or` (operators AND, OR, WITH are upper-case).",
    ],
  ])("scores `%s` 2 as not recognised", (v, reason) => {
    const r = scoreLicense(lic(v), "", OWN_FILE, INHERITED);
    expect(r.score).toBe(2);
    expect(r.licenseStatus).toBe("unrecognised");
    expect(r.findings).toContain(`License declared as \`${v}\` ${reason}`);
  });

  it("scores an SPDX + private mix under the SPDX licence rule and says so", () => {
    const v = "Apache-2.0 OR Proprietary";
    const noFile = scoreLicense(lic(v), "", NO_OWN_FILE);
    expect(noFile.score).toBe(5);
    expect(noFile.licenseStatus).toBe("recognised");
    expect(noFile.findings[0]).toBe(
      "License declared: `Apache-2.0 OR Proprietary` mixes SPDX terms with private terms (`Proprietary`), so it is not valid SPDX as written (use `LicenseRef-Proprietary` for the private terms) — SPDX licence rule applied: the SPDX terms need a licence file; the private-licence rule (#771) covers only declarations with no SPDX identifier.",
    );
    expect(scoreLicense(lic(v), "", OWN_FILE).score).toBe(10);
    expect(scoreLicense(lic(v), "", NO_OWN_FILE, INHERITED).score).toBe(10);
  });

  it.each([
    "PROPRIETARY AND CONFIDENTIAL",
    "PRIVATE AND CONFIDENTIAL",
    "Proprietary - see TERMS AND CONDITIONS",
    "COPYRIGHT (C) 2026 FOO AND BAR. ALL RIGHTS RESERVED.",
    "Copyright Acme, MIT licensed. All rights reserved.",
    "Proprietary OR",
    "Proprietary OR Foo-1.0",
    "Proprietary — Fair use only",
    "UNLICENSED",
  ])("keeps the #771 private rule for `%s` (no SPDX identifier named)", (v) => {
    const r = scoreLicense(lic(v), "", NO_OWN_FILE);
    expect(r.score).toBe(8);
    expect(r.licenseStatus).toBe("private");
  });
});

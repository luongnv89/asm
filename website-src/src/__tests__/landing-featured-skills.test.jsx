/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";

/**
 * Regression test for the landing page review of PR #732 / issue #733.
 *
 * The `asm eval` score badge on the featured-skill cards renders 11px
 * metadata text. It previously used `--fg-muted` (#8b8d9a on the light
 * card, #6b6d7a on the dark card), which is ~3.3:1 / ~3.7:1 — below the
 * WCAG AA 4.5:1 minimum for that size. It must use a token that clears
 * the bar; `--fg-dim` measures 8.5:1 (light) and 7.3:1 (dark).
 */
vi.mock("../hooks/useCatalog.jsx", () => ({
  useCatalog: () => ({
    loading: false,
    error: null,
    miniSearch: null,
    searchError: null,
    catalog: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      totalSkills: 2,
      totalRepos: 1,
      categories: ["demo"],
      skills: [
        {
          id: "luongnv89/asm::skills/find-me-skills::find-me-skills",
          name: "find-me-skills",
          evalSummary: { overallScore: 92, grade: "A" },
        },
        {
          id: "luongnv89/asm::skills/skill-creator::skill-creator",
          name: "skill-creator",
          evalSummary: { overallScore: 90, grade: "A" },
        },
      ],
    },
  }),
}));

import LandingPage from "../pages/LandingPage.jsx";

describe("LandingPage — featured skill eval badge contrast (#733)", () => {
  afterEach(() => cleanup());

  it("renders the score badge with a WCAG-AA-safe foreground token", () => {
    render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <LandingPage />
      </HashRouter>,
    );

    const badges = screen.getAllByTitle(
      "asm eval score from the latest catalog build",
    );
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge.className).toContain("text-[var(--fg-dim)]");
      expect(badge.className).not.toContain("--fg-muted");
    }
  });
});

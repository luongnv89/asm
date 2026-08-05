/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router-dom";
import ProfilePage from "../pages/ProfilePage.jsx";
import { encodeSkillId } from "../lib/utils.js";

const topSkills = [
  {
    id: "alice/tools::skills/alpha::alpha",
    name: "alpha",
    repo: "alice/tools",
  },
  {
    id: "alice/tools::skills/beta::beta",
    name: "beta",
    repo: "alice/tools",
  },
];

const author = {
  owner: "alice",
  totalSkills: 2,
  repos: ["alice/tools"],
  categories: { coding: 2 },
  verifiedCount: 2,
  totalTokens: 400,
  topSkills,
};

describe("ProfilePage — skill detail links (issue #398)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#/profile/alice");
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stats: [author] }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("links every listed skill to its canonically encoded detail route", async () => {
    const { container } = render(
      <HashRouter>
        <Routes>
          <Route path="/profile/:owner" element={<ProfilePage />} />
        </Routes>
      </HashRouter>,
    );

    for (const skill of topSkills) {
      const link = await screen.findByRole("link", { name: skill.name });
      expect(link.getAttribute("href")).toBe(
        `#/skills/${encodeSkillId(skill.id)}`,
      );
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("min-w-11");
    }

    expect(container.querySelector("span.w-6").className).toContain(
      "text-[var(--fg-dim)]",
    );
  });
});

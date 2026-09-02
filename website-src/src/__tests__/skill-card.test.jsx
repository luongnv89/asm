/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import SkillCard from "../components/SkillCard.jsx";

/**
 * Regression tests for issue #241 — when multiple install paths share a
 * (owner, repo, name) tuple (plugin-bundle layouts) the product cards
 * used to look identical. Rendering `hasNameCollision` must surface the
 * distinguishing relPath so the user can tell the siblings apart.
 */

const baseSkill = {
  id: "sickn33/antigravity-awesome-skills::plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant::00-andruia-consultant",
  name: "00-andruia-consultant",
  description: "Arquitecto de Soluciones Principal.",
  owner: "sickn33",
  repo: "antigravity-awesome-skills",
  categories: ["general"],
  installUrl:
    "github:sickn33/antigravity-awesome-skills:plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
  license: "",
  version: "0.0.0",
  verified: true,
  hasTools: false,
};

function renderCard(skill = baseSkill, props = {}) {
  return render(
    <HashRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <SkillCard
        skill={skill}
        index={0}
        searchQuery=""
        searchTerms={null}
        locationSearch=""
        {...props}
      />
    </HashRouter>,
  );
}

describe("SkillCard — name collision labeling (issue #241)", () => {
  afterEach(() => cleanup());

  it("does not render the install path when there is no collision", () => {
    renderCard(baseSkill, { hasNameCollision: false });
    expect(
      screen.queryByText(/plugins\/antigravity-awesome-skills-claude/),
    ).toBeNull();
  });

  it("renders the distinguishing install path when hasNameCollision is true", () => {
    renderCard(baseSkill, { hasNameCollision: true });
    expect(
      screen.getByText(
        "plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
      ),
    ).toBeTruthy();
  });

  it("yields a different rendered path for each sibling in a collision group", () => {
    const { unmount } = renderCard(baseSkill, { hasNameCollision: true });
    expect(
      screen.getByText(
        "plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
      ),
    ).toBeTruthy();
    unmount();

    const sibling = {
      ...baseSkill,
      id: "sickn33/antigravity-awesome-skills::skills/00-andruia-consultant::00-andruia-consultant",
      installUrl:
        "github:sickn33/antigravity-awesome-skills:skills/00-andruia-consultant",
    };
    renderCard(sibling, { hasNameCollision: true });
    expect(screen.getByText("skills/00-andruia-consultant")).toBeTruthy();
    expect(
      screen.queryByText(
        "plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
      ),
    ).toBeNull();
  });
});

describe("SkillCard — storefront anatomy", () => {
  afterEach(() => cleanup());

  it("links the title to the product page and preserves the search string", () => {
    renderCard(baseSkill, { locationSearch: "?cat=general&page=2" });
    const link = screen.getByRole("link", { name: "00-andruia-consultant" });
    expect(link.getAttribute("href")).toContain("/skills/");
    expect(link.getAttribute("href")).toContain("cat=general");
    expect(link.getAttribute("href")).toContain("page=2");
  });

  it("renders an add-to-cart button that names the skill", () => {
    renderCard();
    expect(
      screen.getByRole("button", { name: "Add 00-andruia-consultant to cart" }),
    ).toBeTruthy();
  });

  it("shows the eval score as the price sticker when present", () => {
    const { container } = renderCard({
      ...baseSkill,
      evalSummary: { overallScore: 91, grade: "A" },
    });
    const sticker = container.querySelector(".shop-sticker");
    expect(sticker).toBeTruthy();
    expect(sticker.textContent).toContain("91");
    expect(sticker.getAttribute("data-grade")).toBe("A");
  });

  it("marks unscored skills instead of hiding the sticker", () => {
    const { container } = renderCard();
    const sticker = container.querySelector(".shop-sticker");
    expect(sticker?.textContent).toContain("not scored");
  });
});

describe("SkillCard — GitHub star badge (repo trust signal)", () => {
  afterEach(() => cleanup());

  /**
   * Helper to find the star badge by its title attribute, which is unique
   * per skill and never collides with skill name / owner / repo text.
   */
  function getStarBadge(container) {
    return container.querySelector('span[title$="GitHub stars"]');
  }

  it("renders a star badge when stars is present and > 0", () => {
    const { container } = renderCard({ ...baseSkill, stars: 1234 });
    const badge = getStarBadge(container);
    expect(badge).toBeTruthy();
    // 1234 -> "1.2k" via formatStars
    expect(badge.textContent).toContain("1.2k");
  });

  it("does not render a star badge when stars is 0", () => {
    const { container } = renderCard({ ...baseSkill, stars: 0 });
    expect(getStarBadge(container)).toBeNull();
  });

  it("does not render a star badge when stars is missing", () => {
    const { container } = renderCard();
    expect(getStarBadge(container)).toBeNull();

    // Also test with explicit undefined
    cleanup();
    const second = renderCard({ ...baseSkill, stars: undefined });
    expect(getStarBadge(second.container)).toBeNull();
  });

  it("displays small star counts without abbreviation", () => {
    const { container } = renderCard({ ...baseSkill, stars: 42 });
    const badge = getStarBadge(container);
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("42");
  });
});

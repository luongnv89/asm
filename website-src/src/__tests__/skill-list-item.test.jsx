/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import SkillListItem from "../components/SkillListItem.jsx";

/**
 * Regression tests for issue #241 — when multiple install paths share a
 * (owner, repo, name) tuple (plugin-bundle layouts) the list rows used to
 * look identical. Rendering `hasNameCollision` must surface the
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

function renderItem(props) {
  return render(
    <HashRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <SkillListItem
        skill={baseSkill}
        active={false}
        searchQuery=""
        searchTerms={null}
        locationSearch=""
        {...props}
      />
    </HashRouter>,
  );
}

describe("SkillListItem — name collision labeling (issue #241)", () => {
  afterEach(() => cleanup());

  it("does not render the install path when there is no collision", () => {
    renderItem({ hasNameCollision: false });
    expect(
      screen.queryByText(/plugins\/antigravity-awesome-skills-claude/),
    ).toBeNull();
  });

  it("renders the distinguishing install path when hasNameCollision is true", () => {
    renderItem({ hasNameCollision: true });
    expect(
      screen.getByText(
        "plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
      ),
    ).toBeTruthy();
  });

  it("yields a different rendered path for each sibling in a collision group", () => {
    const { unmount } = renderItem({ hasNameCollision: true });
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
    render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SkillListItem
          skill={sibling}
          active={false}
          searchQuery=""
          searchTerms={null}
          locationSearch=""
          hasNameCollision={true}
        />
      </HashRouter>,
    );
    expect(screen.getByText("skills/00-andruia-consultant")).toBeTruthy();
    expect(
      screen.queryByText(
        "plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
      ),
    ).toBeNull();
  });
});

describe("SkillListItem — GitHub star badge (repo trust signal)", () => {
  afterEach(() => cleanup());

  /**
   * Helper to find the star badge by its title attribute, which is unique
   * per skill and never collides with skill name / owner / repo text.
   */
  function getStarBadge(container) {
    return container.querySelector('span[title$="GitHub stars"]');
  }

  it("renders a star badge when stars is present and > 0", () => {
    const skillWithStars = { ...baseSkill, stars: 1234 };
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SkillListItem
          skill={skillWithStars}
          active={false}
          searchQuery=""
          searchTerms={null}
          locationSearch=""
        />
      </HashRouter>,
    );
    const badge = getStarBadge(container);
    expect(badge).toBeTruthy();
    // 1234 -> "1.2k" via formatStars
    expect(badge.textContent).toContain("1.2k");
  });

  it("does not render a star badge when stars is 0", () => {
    const skillNoStars = { ...baseSkill, stars: 0 };
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SkillListItem
          skill={skillNoStars}
          active={false}
          searchQuery=""
          searchTerms={null}
          locationSearch=""
        />
      </HashRouter>,
    );
    expect(getStarBadge(container)).toBeNull();
  });

  it("does not render a star badge when stars is missing", () => {
    const { container } = renderItem({});
    expect(getStarBadge(container)).toBeNull();

    // Also test with explicit undefined
    const skillNoStarsField = { ...baseSkill, stars: undefined };
    render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SkillListItem
          skill={skillNoStarsField}
          active={false}
          searchQuery=""
          searchTerms={null}
          locationSearch=""
        />
      </HashRouter>,
    );
    expect(getStarBadge(container)).toBeNull();
  });

  it("displays small star counts without abbreviation", () => {
    const skillWithStars = { ...baseSkill, stars: 42 };
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SkillListItem
          skill={skillWithStars}
          active={false}
          searchQuery=""
          searchTerms={null}
          locationSearch=""
        />
      </HashRouter>,
    );
    const badge = getStarBadge(container);
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("42");
  });
});

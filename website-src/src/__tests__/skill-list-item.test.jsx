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

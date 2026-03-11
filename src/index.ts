import { createCliRenderer } from "@opentui/core";
import type { SkillInfo, Scope, SortBy, ViewState } from "./utils/types";
import { scanAllSkills, searchSkills, sortSkills } from "./scanner";
import { buildRemovalPlan, buildFullRemovalPlan, executeRemoval, getExistingTargets } from "./uninstaller";
import { createDashboard } from "./views/dashboard";
import { createSkillList } from "./views/skill-list";
import { createDetailView } from "./views/skill-detail";
import { createConfirmView } from "./views/confirm";
import { createHelpView } from "./views/help";

// ─── State ──────────────────────────────────────────────────────────────────
let allSkills: SkillInfo[] = [];
let filteredSkills: SkillInfo[] = [];
let currentScope: Scope = "both";
let currentSort: SortBy = "name";
let searchQuery = "";
let viewState: ViewState = "dashboard";
let selectedSkill: SkillInfo | null = null;
let searchMode = false;

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
  });

  // ── Build Dashboard ─────────────────────────────────────────────────────
  const dashboard = createDashboard(renderer, async (scope: Scope) => {
    currentScope = scope;
    await refreshSkills();
  });

  // ── Skill List ──────────────────────────────────────────────────────────
  const skillList = createSkillList(renderer, [], (skill: SkillInfo) => {
    showDetail(skill);
  }, renderer.width);
  dashboard.contentArea.add(skillList.container);

  // ── Overlay containers ──────────────────────────────────────────────────
  let overlayContainer: any = null;

  // ── Helpers ─────────────────────────────────────────────────────────────
  async function refreshSkills() {
    allSkills = await scanAllSkills(currentScope);
    applyFilters();
  }

  function applyFilters() {
    let skills = searchSkills(allSkills, searchQuery);
    skills = sortSkills(skills, currentSort);
    filteredSkills = skills;
    skillList.update(filteredSkills);
    dashboard.updateStats(allSkills);
    dashboard.updateSortLabel(currentSort);
  }

  function removeOverlay() {
    if (overlayContainer) {
      renderer.root.remove(overlayContainer.id);
      overlayContainer = null;
    }
    viewState = "dashboard";
    skillList.select.focus();
  }

  function showDetail(skill: SkillInfo) {
    removeOverlay();
    selectedSkill = skill;
    viewState = "detail";
    overlayContainer = createDetailView(renderer, skill);
    renderer.root.add(overlayContainer);
  }

  async function showConfirm(skill: SkillInfo) {
    removeOverlay();
    selectedSkill = skill;
    viewState = "confirm";

    const plan = buildFullRemovalPlan(skill.dirName, allSkills);
    const targets = await getExistingTargets(plan);

    overlayContainer = createConfirmView(renderer, skill, targets, async (result) => {
      if (result.confirmed) {
        await executeRemoval(plan);
        removeOverlay();
        await refreshSkills();
      } else {
        removeOverlay();
      }
    });
    renderer.root.add(overlayContainer);
  }

  function showHelp() {
    removeOverlay();
    viewState = "help";
    overlayContainer = createHelpView(renderer);
    renderer.root.add(overlayContainer);
  }

  function cycleSortOrder() {
    const orders: SortBy[] = ["name", "version", "location"];
    const idx = orders.indexOf(currentSort);
    currentSort = orders[(idx + 1) % orders.length];
    applyFilters();
  }

  function enterSearchMode() {
    searchMode = true;
    dashboard.searchInput.focus();
  }

  function exitSearchMode() {
    searchMode = false;
    searchQuery = "";
    dashboard.searchInput.initialValue = "";
    applyFilters();
    skillList.select.focus();
  }

  // ── Keyboard Handling ───────────────────────────────────────────────────
  (renderer.keyInput as any).on("keypress", (key: any) => {
    // In search mode, handle Esc to exit and Enter to confirm
    if (searchMode) {
      if (key.name === "escape") {
        exitSearchMode();
        return;
      }
      if (key.name === "return") {
        searchQuery = dashboard.searchInput.plainText || "";
        searchMode = false;
        applyFilters();
        skillList.select.focus();
        return;
      }
      // Live filtering as user types
      setTimeout(() => {
        searchQuery = dashboard.searchInput.plainText || "";
        applyFilters();
      }, 10);
      return;
    }

    // Global keys
    if (key.name === "q" && viewState === "dashboard") {
      renderer.destroy();
      process.exit(0);
    }

    if (key.name === "escape") {
      if (viewState !== "dashboard") {
        removeOverlay();
      }
      return;
    }

    // Help overlay
    if (key.sequence === "?") {
      if (viewState === "help") {
        removeOverlay();
      } else if (viewState === "dashboard") {
        showHelp();
      }
      return;
    }

    // Dashboard-specific keys
    if (viewState === "dashboard") {
      if (key.name === "/" || key.sequence === "/") {
        enterSearchMode();
        return;
      }

      if (key.name === "s" && !key.ctrl) {
        cycleSortOrder();
        return;
      }

      if (key.name === "tab") {
        const scopes: Scope[] = ["global", "project", "both"];
        const idx = scopes.indexOf(currentScope);
        currentScope = scopes[(idx + 1) % scopes.length];
        const tabMap: Record<Scope, number> = { global: 0, project: 1, both: 2 };
        dashboard.scopeTabs.setSelectedIndex(tabMap[currentScope]);
        refreshSkills();
        return;
      }

      if (key.name === "d") {
        const skill = getSelectedSkill();
        if (skill) {
          showConfirm(skill);
        }
        return;
      }
    }

    // Detail view keys
    if (viewState === "detail") {
      if (key.name === "d") {
        if (selectedSkill) {
          showConfirm(selectedSkill);
        }
        return;
      }
    }
  });

  function getSelectedSkill(): SkillInfo | null {
    const idx = skillList.select.getSelectedIndex();
    if (idx >= 0 && idx < filteredSkills.length) {
      return filteredSkills[idx];
    }
    return null;
  }

  // ── Mount & Start ───────────────────────────────────────────────────────
  renderer.root.add(dashboard.root);

  // Initial load
  await refreshSkills();
  skillList.select.focus();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

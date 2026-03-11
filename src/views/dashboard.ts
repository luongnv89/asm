import {
  BoxRenderable,
  TextRenderable,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextareaRenderable,
  ASCIIFontRenderable,
} from "@opentui/core";
import type { RenderContext } from "@opentui/core";
import { theme } from "../utils/colors";
import type { SkillInfo, Scope, SortBy } from "../utils/types";

export interface DashboardComponents {
  root: BoxRenderable;
  banner: ASCIIFontRenderable;
  scopeTabs: TabSelectRenderable;
  searchInput: TextareaRenderable;
  statsBar: BoxRenderable;
  contentArea: BoxRenderable;
  footerText: TextRenderable;
  sortLabel: TextRenderable;
  updateStats: (skills: SkillInfo[]) => void;
  updateSortLabel: (by: SortBy) => void;
}

export function createDashboard(
  ctx: RenderContext,
  onScopeChange: (scope: Scope) => void,
): DashboardComponents {
  // Root layout
  const root = new BoxRenderable(ctx, {
    id: "dashboard-root",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    padding: 1,
    gap: 1,
  });

  // ASCII banner
  const banner = new ASCIIFontRenderable(ctx, {
    id: "banner",
    text: "pskills manager",
    color: theme.accent,
  });
  root.add(banner);

  // Scope tabs row
  const tabRow = new BoxRenderable(ctx, {
    id: "tab-row",
    flexDirection: "row",
    width: "100%",
    height: 3,
    alignItems: "center",
    gap: 2,
  });

  const scopeTabs = new TabSelectRenderable(ctx, {
    id: "scope-tabs",
    options: [
      { name: "Global", description: "~/.claude & ~/.agents", value: "global" },
      { name: "Project", description: ".claude & .agents", value: "project" },
      { name: "Both", description: "All locations", value: "both" },
    ],
    tabWidth: 12,
    showUnderline: true,
    wrapSelection: true,
    height: 3,
    width: 42,
  });

  (scopeTabs as any).on(TabSelectRenderableEvents.ITEM_SELECTED, (_index: number, option: any) => {
    onScopeChange(option.value as Scope);
  });

  const sortLabel = new TextRenderable(ctx, {
    id: "sort-label",
    content: "Sort: name",
    fg: theme.fgDim,
    width: 20,
  });

  tabRow.add(scopeTabs);
  tabRow.add(sortLabel);
  root.add(tabRow);

  // Search box
  const searchBox = new BoxRenderable(ctx, {
    id: "search-box",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.border,
    title: " Filter ",
    titleAlignment: "left",
    width: "100%",
    height: 3,
  });

  const searchInput = new TextareaRenderable(ctx, {
    id: "search-input",
    width: "100%",
    height: 1,
    placeholder: "type to search...",
    placeholderColor: theme.fgDim,
  });

  searchBox.add(searchInput);
  root.add(searchBox);

  // Content area (skill list gets inserted here)
  const contentArea = new BoxRenderable(ctx, {
    id: "content-area",
    flexDirection: "column",
    width: "100%",
    flexGrow: 1,
    minHeight: 6,
  });
  root.add(contentArea);

  // Stats bar
  const statsBar = new BoxRenderable(ctx, {
    id: "stats-bar",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.border,
    title: " Stats ",
    titleAlignment: "left",
    flexDirection: "row",
    width: "100%",
    height: 3,
    paddingLeft: 1,
    paddingRight: 1,
    gap: 3,
  });

  const totalStat = new TextRenderable(ctx, {
    id: "stat-total",
    content: "Total: 0",
    fg: theme.fg,
  });
  const globalStat = new TextRenderable(ctx, {
    id: "stat-global",
    content: "Global: 0",
    fg: theme.cyan,
  });
  const projectStat = new TextRenderable(ctx, {
    id: "stat-project",
    content: "Project: 0",
    fg: theme.green,
  });
  const symlinkStat = new TextRenderable(ctx, {
    id: "stat-symlinks",
    content: "Symlinks: 0",
    fg: theme.yellow,
  });
  const dirStat = new TextRenderable(ctx, {
    id: "stat-dirs",
    content: "Dirs: 0",
    fg: theme.accentAlt,
  });

  statsBar.add(totalStat);
  statsBar.add(globalStat);
  statsBar.add(projectStat);
  statsBar.add(symlinkStat);
  statsBar.add(dirStat);
  root.add(statsBar);

  // Footer
  const footerText = new TextRenderable(ctx, {
    id: "footer",
    content: "  ↑/↓ Navigate  Enter View  d Uninstall  / Filter  Tab Scope  s Sort  q Quit  ? Help",
    fg: theme.fgDim,
    height: 1,
    width: "100%",
  });
  root.add(footerText);

  function updateStats(skills: SkillInfo[]) {
    const total = skills.length;
    const globalCount = skills.filter((s) => s.scope === "global").length;
    const projectCount = skills.filter((s) => s.scope === "project").length;
    const symlinks = skills.filter((s) => s.isSymlink).length;
    const dirs = skills.filter((s) => !s.isSymlink).length;

    totalStat.content = `Total: ${total}`;
    globalStat.content = `Global: ${globalCount}`;
    projectStat.content = `Project: ${projectCount}`;
    symlinkStat.content = `Symlinks: ${symlinks}`;
    dirStat.content = `Dirs: ${dirs}`;
  }

  function updateSortLabel(by: SortBy) {
    sortLabel.content = `Sort: ${by}`;
  }

  return {
    root,
    banner,
    scopeTabs,
    searchInput,
    statsBar,
    contentArea,
    footerText,
    sortLabel,
    updateStats,
    updateSortLabel,
  };
}

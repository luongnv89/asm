import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
} from "@opentui/core";
import type { RenderContext } from "@opentui/core";
import { theme } from "../utils/colors";
import type { SkillInfo } from "../utils/types";

function formatSkillRow(skill: SkillInfo, descWidth: number): string {
  const prefix = skill.isSymlink ? "~ " : "  ";
  const nameMax = 26 - prefix.length;
  const rawName = skill.name.length > nameMax ? skill.name.slice(0, nameMax - 3) + "..." : skill.name;
  const name = prefix + rawName;
  const ver = skill.version.length > 7 ? skill.version.slice(0, 7) : skill.version;
  const loc = skill.location;
  const type = skill.isSymlink ? "\u2192link" : " dir ";
  const desc = descWidth > 0
    ? " " + (skill.description || "").slice(0, descWidth)
    : "";
  return `${name.padEnd(28)} ${ver.padEnd(8)} ${loc.padEnd(16)} ${type.padEnd(6)}${desc}`;
}

function buildOptions(skills: SkillInfo[], descWidth: number) {
  if (skills.length === 0) {
    return [{ name: "  (no skills found)", description: "", value: "__none__" }];
  }
  return skills.map((s) => ({
    name: formatSkillRow(s, descWidth),
    description: "",
    value: s.dirName,
  }));
}

function calcDescWidth(termWidth: number): number {
  // 2(border) + 2(padding) + 28(name) + 8(ver) + 16(loc) + 6(type) + 4(spaces) = 66
  const fixed = 66;
  return Math.max(0, termWidth - fixed);
}

export function createSkillList(
  ctx: RenderContext,
  skills: SkillInfo[],
  onSelect: (skill: SkillInfo) => void,
  termWidth: number = 80,
): { container: BoxRenderable; select: SelectRenderable; update: (skills: SkillInfo[], tw?: number) => void } {
  let descWidth = calcDescWidth(termWidth);

  const container = new BoxRenderable(ctx, {
    id: "skill-list-box",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.border,
    title: ` Skills (${skills.length}) `,
    titleAlignment: "left",
    flexDirection: "column",
    width: "100%",
    flexGrow: 1,
    minHeight: 6,
  });

  // Header row
  const descHeader = descWidth > 0 ? " Description" : "";
  const headerRow = new TextRenderable(ctx, {
    id: "skill-list-header",
    content: `  ${"Name".padEnd(28)} ${"Ver".padEnd(8)} ${"Location".padEnd(16)} ${"Type".padEnd(6)}${descHeader}`,
    fg: theme.fgDim,
    height: 1,
  });

  const select = new SelectRenderable(ctx, {
    id: "skill-select",
    width: "100%",
    flexGrow: 1,
    options: buildOptions(skills, descWidth),
    wrapSelection: true,
    showScrollIndicator: true,
    fastScrollStep: 5,
    showDescription: false,
  });

  let currentSkills = skills;

  (select as any).on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
    if (currentSkills[index]) {
      onSelect(currentSkills[index]);
    }
  });

  container.add(headerRow);
  container.add(select);

  function update(newSkills: SkillInfo[], tw?: number) {
    if (tw !== undefined) {
      descWidth = calcDescWidth(tw);
    }
    currentSkills = newSkills;
    select.options = buildOptions(newSkills, descWidth);
    container.title = ` Skills (${newSkills.length}) `;
  }

  return { container, select, update };
}

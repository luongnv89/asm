import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
} from "@opentui/core";
import type { RenderContext } from "@opentui/core";
import { theme } from "../utils/colors";
import type { SkillInfo } from "../utils/types";
import { formatTokenCount } from "../utils/token-count";

function compactTokens(tokenCount: number | undefined): string {
  if (typeof tokenCount !== "number") return "\u2014";
  // Compact form (no "tokens" suffix): "~3", "~1.2k", "~12k" — fits a 7-char column.
  return formatTokenCount(tokenCount).replace(/ tokens$/, "");
}

function formatSkillRow(
  index: number,
  skill: SkillInfo,
  descWidth: number,
): string {
  const idx = String(index).padStart(3);
  const prefix = skill.isSymlink ? "~ " : "  ";
  const nameMax = 24 - prefix.length;
  const rawName =
    skill.name.length > nameMax
      ? skill.name.slice(0, nameMax - 3) + "..."
      : skill.name;
  const name = prefix + rawName;
  const ver =
    skill.version.length > 7 ? skill.version.slice(0, 7) : skill.version;
  const creatorRaw = skill.creator || "\u2014";
  const creator = creatorRaw.length > 12 ? creatorRaw.slice(0, 12) : creatorRaw;
  const effortRaw = skill.effort || "\u2014";
  const effort = effortRaw.length > 6 ? effortRaw.slice(0, 6) : effortRaw;
  const tokensRaw = compactTokens(skill.tokenCount);
  const tokens = tokensRaw.length > 7 ? tokensRaw.slice(0, 7) : tokensRaw;
  const prov =
    skill.providerLabel.length > 11
      ? skill.providerLabel.slice(0, 11)
      : skill.providerLabel;
  const scope = skill.scope;
  const type = skill.isSymlink ? "\u2192link" : " dir ";
  const desc =
    descWidth > 0 ? " " + (skill.description || "").slice(0, descWidth) : "";
  return `${idx} ${name.padEnd(24)} ${ver.padEnd(8)} ${creator.padEnd(13)} ${effort.padEnd(7)} ${tokens.padEnd(8)} ${prov.padEnd(12)} ${scope.padEnd(8)} ${type.padEnd(6)}${desc}`;
}

function buildOptions(skills: SkillInfo[], descWidth: number) {
  if (skills.length === 0) {
    return [
      { name: "     (no skills found)", description: "", value: "__none__" },
    ];
  }
  return skills.map((s, i) => ({
    name: formatSkillRow(i + 1, s, descWidth),
    description: "",
    value: s.dirName,
  }));
}

function calcDescWidth(termWidth: number): number {
  // 2(border) + 2(padding) + 4(#) + 24(name) + 8(ver) + 13(creator) + 7(effort)
  // + 8(tokens) + 12(provider) + 8(scope) + 6(type) + 9(spaces) = 103
  const fixed = 103;
  return Math.max(0, termWidth - fixed);
}

export function createSkillList(
  ctx: RenderContext,
  skills: SkillInfo[],
  onSelect: (skill: SkillInfo) => void,
  termWidth: number = 80,
): {
  container: BoxRenderable;
  select: SelectRenderable;
  update: (skills: SkillInfo[], tw?: number) => void;
} {
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
    content: `${"#".padStart(3)} ${"Name".padEnd(26)} ${"Ver".padEnd(8)} ${"Creator".padEnd(13)} ${"Effort".padEnd(7)} ${"Tokens".padEnd(8)} ${"Tool".padEnd(12)} ${"Scope".padEnd(8)} ${"Type".padEnd(6)}${descHeader}`,
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

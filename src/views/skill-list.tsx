import React from "react";
import { Box, Text } from "ink";
import { theme } from "../utils/colors";
import type { SkillInfo } from "../utils/types";
import { formatTokenCount } from "../utils/token-count";
import { formatInvocability } from "../utils/frontmatter";

function compactTokens(tokenCount: number | undefined): string {
  if (typeof tokenCount !== "number") return "—";
  return formatTokenCount(tokenCount).replace(/ tokens$/, "");
}

function calcDescWidth(termWidth: number): number {
  // 2(border) + 2(padding) + 4(#) + 24(name) + 8(ver) + 13(creator) + 7(effort)
  // + 7(invoke) + 8(tokens) + 12(provider) + 8(scope) + 6(type) + 10(spaces) = 111
  const fixed = 111;
  return Math.max(0, termWidth - fixed);
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
  const creatorRaw = skill.creator || "—";
  const creator = creatorRaw.length > 12 ? creatorRaw.slice(0, 12) : creatorRaw;
  const effortRaw = skill.effort || "—";
  const effort = effortRaw.length > 6 ? effortRaw.slice(0, 6) : effortRaw;
  const invoke = formatInvocability(skill.modelInvocable, skill.userInvocable);
  const tokensRaw = compactTokens(skill.tokenCount);
  const tokens = tokensRaw.length > 7 ? tokensRaw.slice(0, 7) : tokensRaw;
  const prov =
    skill.providerLabel.length > 11
      ? skill.providerLabel.slice(0, 11)
      : skill.providerLabel;
  const scope = skill.scope;
  const type = skill.isSymlink ? "→link" : " dir ";
  const desc =
    descWidth > 0 ? " " + (skill.description || "").slice(0, descWidth) : "";
  return `${idx} ${name.padEnd(24)} ${ver.padEnd(8)} ${creator.padEnd(13)} ${effort.padEnd(7)} ${invoke.padEnd(6)} ${tokens.padEnd(8)} ${prov.padEnd(12)} ${scope.padEnd(8)} ${type.padEnd(6)}${desc}`;
}

export interface SkillListProps {
  skills: SkillInfo[];
  selectedIndex: number;
  visibleCount: number;
  termWidth: number;
}

export function SkillListView({
  skills,
  selectedIndex,
  visibleCount,
  termWidth,
}: SkillListProps) {
  const descWidth = calcDescWidth(termWidth);
  const descHeader = descWidth > 0 ? " Description" : "";
  const header = `${"#".padStart(3)} ${"Name".padEnd(26)} ${"Ver".padEnd(8)} ${"Creator".padEnd(13)} ${"Effort".padEnd(7)} ${"Invoke".padEnd(6)} ${"Tokens".padEnd(8)} ${"Tool".padEnd(12)} ${"Scope".padEnd(8)} ${"Type".padEnd(6)}${descHeader}`;

  // Compute scroll window so the cursor stays visible
  const total = skills.length;
  const max = Math.max(1, visibleCount);
  let start = 0;
  if (total > max) {
    start = Math.max(
      0,
      Math.min(total - max, selectedIndex - Math.floor(max / 2)),
    );
  }
  const end = Math.min(total, start + max);
  const visible = skills.slice(start, end);
  const showTopIndicator = start > 0;
  const showBottomIndicator = end < total;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      flexGrow={1}
      paddingX={1}
    >
      <Text color={theme.fgDim}> Skills ({total})</Text>
      <Text color={theme.fgDim}>{header}</Text>
      {total === 0 && <Text color={theme.fgDim}> (no skills found)</Text>}
      {showTopIndicator && <Text color={theme.fgDim}> ↑ more above</Text>}
      {visible.map((s, i) => {
        const absoluteIndex = start + i;
        const isSelected = absoluteIndex === selectedIndex;
        const row = formatSkillRow(absoluteIndex + 1, s, descWidth);
        const prefix = isSelected ? "❯ " : "  ";
        return (
          <Text
            key={`${s.path}-${absoluteIndex}`}
            color={isSelected ? theme.accent : theme.fg}
            inverse={isSelected}
          >
            {prefix}
            {row}
          </Text>
        );
      })}
      {showBottomIndicator && <Text color={theme.fgDim}> ↓ more below</Text>}
    </Box>
  );
}

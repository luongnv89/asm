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

// East Asian Wide / Fullwidth characters render two terminal cells while
// counting as one code unit, so length/slice/padEnd mis-size CJK content and
// rows overflow. Width helpers below measure cell width instead.
const WIDE =
  /[\u1100-\u115F\u2E80-\uA4CF\u3040-\u30FF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function stringWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

function truncateByWidth(s: string, max: number): string {
  if (stringWidth(s) <= max) return s;
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (w + cw > max) break;
    w += cw;
    out += ch;
  }
  return out;
}

function padEndByWidth(s: string, max: number): string {
  return s + " ".repeat(Math.max(0, max - stringWidth(s)));
}

export function calcDescWidth(termWidth: number): number {
  // Fixed (non-description) row content, measured empirically from
  // formatSkillRow with descWidth=0: "{prefix}{idx} {name} {ver} {creator}
  // {effort} {invoke} {tokens} {prov} {scope} {type}" plus the box's
  // border/padding and the description's own leading space.
  //   2(border) + 2(padding) + 2(prefix) + 3(idx) + 24(name) + 8(ver)
  //   + 11(creator) + 7(effort) + 6(invoke) + 6(tokens) + 12(provider)
  //   + 7(scope) + 5(type) + 9(spaces between fields) + 1(desc leading space)
  //   = 105
  const fixed = 105;
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
    stringWidth(skill.name) > nameMax
      ? truncateByWidth(skill.name, nameMax - 3) + "..."
      : skill.name;
  const name = prefix + rawName;
  const ver =
    skill.version.length > 7 ? skill.version.slice(0, 7) : skill.version;
  const creatorRaw = skill.creator || "—";
  const creator =
    stringWidth(creatorRaw) > 10 ? truncateByWidth(creatorRaw, 10) : creatorRaw;
  const effortRaw = skill.effort || "—";
  const effort =
    stringWidth(effortRaw) > 6 ? truncateByWidth(effortRaw, 6) : effortRaw;
  const invoke = formatInvocability(skill.modelInvocable, skill.userInvocable);
  const tokensRaw = compactTokens(skill.tokenCount);
  const tokens = tokensRaw.length > 5 ? tokensRaw.slice(0, 5) : tokensRaw;
  const prov =
    skill.providerLabel.length > 11
      ? skill.providerLabel.slice(0, 11)
      : skill.providerLabel;
  const scope = skill.scope;
  const type = skill.isSymlink ? "→link" : " dir ";
  const desc =
    descWidth > 0
      ? " " + truncateByWidth(skill.description || "", descWidth)
      : "";
  return `${idx} ${padEndByWidth(name, 24)} ${ver.padEnd(8)} ${padEndByWidth(creator, 11)} ${padEndByWidth(effort, 7)} ${invoke.padEnd(6)} ${tokens.padEnd(6)} ${padEndByWidth(prov, 12)} ${scope.padEnd(7)} ${type.padEnd(5)}${desc}`;
}

export interface SkillListProps {
  skills: SkillInfo[];
  selectedIndex: number;
  visibleCount: number;
  termWidth: number;
  hasScanned: boolean;
  searchQuery: string;
}

export function SkillListView({
  skills,
  selectedIndex,
  visibleCount,
  termWidth,
  hasScanned,
  searchQuery,
}: SkillListProps) {
  const descWidth = calcDescWidth(termWidth);
  const descHeader = descWidth > 0 ? " Description" : "";
  const header = `${"#".padStart(3)} ${"Name".padEnd(26)} ${"Ver".padEnd(8)} ${"Creator".padEnd(11)} ${"Effort".padEnd(7)} ${"Invoke".padEnd(6)} ${"Tokens".padEnd(6)} ${"Tool".padEnd(12)} ${"Scope".padEnd(7)} ${"Type".padEnd(5)}${descHeader}`;

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
      {total === 0 && hasScanned && (
        <Text color={theme.fgDim}>
          {" "}
          {searchQuery
            ? `no matches for "${searchQuery}"`
            : "(no skills found)"}
        </Text>
      )}
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

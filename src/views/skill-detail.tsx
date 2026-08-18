import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { theme } from "../utils/colors";
import type { SkillInfo } from "../utils/types";
import { countFiles } from "../scanner";
import { wordWrap, HIGH_RISK_TOOLS, MEDIUM_RISK_TOOLS } from "../formatter";
import { formatTokenCount } from "../utils/token-count";
import { formatInvocability } from "../utils/frontmatter";

const EFFORT_COLORS: Record<string, string> = {
  low: theme.green,
  medium: theme.yellow,
  high: theme.red,
  max: theme.accentAlt,
};

function getEvalSummaries(
  skill: SkillInfo,
): NonNullable<SkillInfo["evalSummary"]>[] {
  if (skill.evalSummaries && Object.keys(skill.evalSummaries).length > 0) {
    const summaries = Object.values(skill.evalSummaries) as NonNullable<
      SkillInfo["evalSummary"]
    >[];
    return summaries.sort((a, b) => {
      const aId = a.providerId ?? "quality";
      const bId = b.providerId ?? "quality";
      if (aId === "quality" && bId !== "quality") return -1;
      if (bId === "quality" && aId !== "quality") return 1;
      return aId.localeCompare(bId);
    });
  }
  return skill.evalSummary ? [skill.evalSummary] : [];
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <Box flexDirection="row">
      <Box width={16}>
        <Text color={theme.fgDim}>{`${label}:`}</Text>
      </Box>
      <Text color={valueColor ?? theme.fg}>{value}</Text>
    </Box>
  );
}

export interface SkillDetailProps {
  skill: SkillInfo;
}

export function SkillDetailView({ skill }: SkillDetailProps) {
  const [fileCount, setFileCount] = useState<number | undefined>(
    skill.fileCount,
  );

  useEffect(() => {
    if (skill.fileCount === undefined) {
      countFiles(skill.path)
        .then((count) => setFileCount(count))
        .catch(() => {});
    }
  }, [skill.path, skill.fileCount]);

  const descMaxWidth = 56;
  const desc = skill.description || "(no description)";
  const wrappedDescLines = wordWrap(desc, descMaxWidth);
  const evalSummaries = getEvalSummaries(skill);
  const multipleProviders = evalSummaries.length > 1;
  const highRisk =
    skill.allowedTools?.filter((t) => HIGH_RISK_TOOLS.has(t)) ?? [];
  const actions: string[] = [];
  if (highRisk.includes("Bash")) actions.push("execute shell commands");
  if (highRisk.some((t) => ["Write", "Edit", "NotebookEdit"].includes(t))) {
    actions.push("modify files");
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      width={64}
    >
      <Box justifyContent="center">
        <Text color={theme.accent}> {skill.name} </Text>
      </Box>
      <Row label="Name" value={skill.name} valueColor={theme.accent} />
      <Row label="Version" value={skill.version} valueColor={theme.green} />
      <Row
        label="Creator"
        value={skill.creator || "—"}
        valueColor={skill.creator ? theme.fg : theme.fgDim}
      />
      <Row
        label="License"
        value={skill.license || "—"}
        valueColor={skill.license ? theme.fg : theme.fgDim}
      />
      {skill.compatibility && (
        <Row
          label="Compatibility"
          value={skill.compatibility}
          valueColor={theme.cyan}
        />
      )}
      {skill.effort && (
        <Row
          label="Effort"
          value={skill.effort}
          valueColor={EFFORT_COLORS[skill.effort.toLowerCase()] || theme.fg}
        />
      )}
      <Row
        label="Invocable"
        value={formatInvocability(skill.modelInvocable, skill.userInvocable)}
      />
      <Row
        label="Tool"
        value={skill.providerLabel}
        valueColor={theme.accentAlt}
      />
      <Row label="Location" value={skill.location} valueColor={theme.cyan} />
      <Row label="Path" value={skill.path} />
      <Row
        label="Symlink"
        value={skill.isSymlink ? `yes → ${skill.symlinkTarget}` : "no"}
        valueColor={skill.isSymlink ? theme.yellow : theme.fgDim}
      />
      <Row
        label="Files"
        value={fileCount !== undefined ? String(fileCount) : "..."}
      />
      {typeof skill.tokenCount === "number" && (
        <Row
          label="Est. Tokens"
          value={formatTokenCount(skill.tokenCount)}
          valueColor={theme.cyan}
        />
      )}
      <Row label="Scope" value={skill.scope} valueColor={theme.accentAlt} />

      <Box marginTop={1}>
        <Text color={theme.fgDim}>Description:</Text>
      </Box>
      {wrappedDescLines.map((line, i) => (
        <Text key={`desc-${i}`} color={theme.fg}>
          {"  "}
          {line}
        </Text>
      ))}

      <Box marginTop={1}>
        <Text color={theme.fgDim}>Eval Score:</Text>
      </Box>
      {evalSummaries.length > 0 ? (
        evalSummaries.map((ev, idx) => {
          const overallColor =
            ev.overallScore >= 90
              ? theme.green
              : ev.overallScore >= 80
                ? theme.cyan
                : ev.overallScore >= 65
                  ? theme.yellow
                  : theme.red;
          const providerLabel = ev.providerId
            ? `${ev.providerId}@${ev.providerVersion ?? "?"}`
            : "quality";
          const evVer = ev.evaluatedVersion ? ` — v${ev.evaluatedVersion}` : "";
          return (
            <Box flexDirection="column" key={`eval-${idx}`}>
              <Text color={overallColor}>
                {multipleProviders
                  ? `  ${providerLabel}: ${ev.overallScore}/100  (${ev.grade})`
                  : `  Overall: ${ev.overallScore}/100  (${ev.grade})`}
              </Text>
              <Text color={theme.fgDim}>
                {`  Evaluated: ${ev.evaluatedAt}${evVer}`}
              </Text>
              {ev.categories.map((c) => (
                <Text color={theme.fg} key={`cat-${idx}-${c.id}`}>
                  {`    ${c.name.padEnd(28)} ${c.score}/${c.max}`}
                </Text>
              ))}
            </Box>
          );
        })
      ) : (
        <Text color={theme.fgDim}>
          {"  Not available — run `asm eval` to generate one."}
        </Text>
      )}

      {skill.allowedTools && skill.allowedTools.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text color={theme.fgDim}>Allowed Tools:</Text>
          </Box>
          <Box flexDirection="row">
            <Text>{"  "}</Text>
            {skill.allowedTools.map((t, i) => {
              let color: string = theme.green;
              if (HIGH_RISK_TOOLS.has(t)) color = theme.red;
              else if (MEDIUM_RISK_TOOLS.has(t)) color = theme.yellow;
              const sep = i < skill.allowedTools.length - 1 ? "  " : "";
              return (
                <Text key={`tool-${i}`} color={color}>
                  {t}
                  {sep}
                </Text>
              );
            })}
          </Box>
          {highRisk.length > 0 && actions.length > 0 && (
            <Text color={theme.yellow}>
              {`  ! This skill can ${actions.join(" and ")}`}
            </Text>
          )}
        </>
      )}

      <Box marginTop={1}>
        <Text color={theme.fgDim}>Esc Back d Uninstall</Text>
      </Box>
    </Box>
  );
}

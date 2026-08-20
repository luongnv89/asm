import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "@inkjs/ui";
import { theme } from "../utils/colors";
import type { SkillInfo, Scope, SortBy, AppConfig } from "../utils/types";

const SORT_OPTIONS: SortBy[] = ["name", "version", "location"];

function buildScopeDescription(config: AppConfig): string {
  const labels = config.providers.filter((p) => p.enabled).map((p) => p.label);
  if (labels.length <= 3) return labels.join(", ");
  return labels.slice(0, 2).join(", ") + ` +${labels.length - 2}`;
}

function buildSortLabel(by: SortBy): string {
  return (
    "(s) Sort: " + SORT_OPTIONS.map((o) => (o === by ? `[${o}]` : o)).join("  ")
  );
}

export interface DashboardHeaderProps {
  config: AppConfig;
  skills: SkillInfo[];
  duplicateCount: number;
  sort: SortBy;
  scope: Scope;
  searchMode: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
}

export function DashboardHeader({
  config,
  skills,
  duplicateCount,
  sort,
  scope,
  searchMode,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
}: DashboardHeaderProps) {
  const total = skills.length;
  const unique = new Set(skills.map((s) => s.dirName)).size;
  const globalCount = skills.filter((s) => s.scope === "global").length;
  const projectCount = skills.filter((s) => s.scope === "project").length;
  const symlinks = skills.filter((s) => s.isSymlink).length;
  const providers = new Set(skills.map((s) => s.provider)).size;

  const scopeDesc = buildScopeDescription(config);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent} bold>
          agent-skill-manager
        </Text>
      </Box>

      <Box
        flexDirection="row"
        borderStyle="round"
        borderColor={theme.border}
        paddingX={1}
        gap={3}
      >
        <Text color={theme.fg}>
          Total: {total} ({unique} unique)
        </Text>
        <Text color={theme.cyan}>Global: {globalCount}</Text>
        <Text color={theme.green}>Project: {projectCount}</Text>
        <Text color={theme.yellow}>Symlinks: {symlinks}</Text>
        <Text color={theme.accentAlt}>Tools: {providers}</Text>
        <Text color={theme.orange}>Dupes: {duplicateCount}</Text>
        <Text color={theme.border}>│</Text>
        <Text color={theme.fgDim}>{buildSortLabel(sort)}</Text>
      </Box>

      <Box flexDirection="row" paddingX={1}>
        <ScopeTab label="Global" active={scope === "global"} />
        <Text> </Text>
        <ScopeTab label="Project" active={scope === "project"} />
        <Text> </Text>
        <ScopeTab label="Both" active={scope === "both"} />
        <Text color={theme.fgDim}> — {scopeDesc}</Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor={searchMode ? theme.accent : theme.border}
        paddingX={1}
      >
        {searchMode ? (
          <TextInput
            placeholder="type to search..."
            defaultValue={searchQuery}
            onChange={onSearchChange}
            onSubmit={onSearchSubmit}
          />
        ) : (
          <Text color={searchQuery ? theme.fg : theme.fgDim}>
            {searchQuery || "press / to search..."}
          </Text>
        )}
      </Box>
    </Box>
  );
}

function ScopeTab({ label, active }: { label: string; active: boolean }) {
  return (
    <Text
      color={active ? theme.accent : theme.fgDim}
      inverse={active}
      bold={active}
    >
      {" "}
      {label}{" "}
    </Text>
  );
}

export interface DashboardFooterProps {
  refreshFeedback: boolean;
  scanning: boolean;
  hasScanned: boolean;
}

export function DashboardFooter({
  refreshFeedback,
  scanning,
  hasScanned,
}: DashboardFooterProps) {
  const feedback = refreshFeedback ? " ✓ Updated!" : "";
  return (
    <Text color={theme.fgDim}>
      {" "}
      ↑/↓ <Text color={theme.accent}>Navigate</Text>
      {" · "}
      Enter <Text color={theme.accent}>View</Text>
      {" · "}d <Text color={theme.accent}>Uninstall</Text>
      {" · "}a <Text color={theme.accent}>Audit</Text>
      {" · "}/ <Text color={theme.accent}>Filter</Text>
      {" · "}
      Tab <Text color={theme.accent}>Scope</Text>
      {" · "}s <Text color={theme.accent}>Sort</Text>
      {" · "}r <Text color={theme.accent}>Refresh</Text>
      {" · "}c <Text color={theme.accent}>Config</Text>
      {" · "}q <Text color={theme.accent}>Quit</Text>
      {" · "}? <Text color={theme.accent}>Help</Text>{" "}
      {scanning && !hasScanned && (
        <Text color={theme.yellow}> (Scanning...)</Text>
      )}
      {feedback && <Text color={theme.green}> {feedback}</Text>}
    </Text>
  );
}

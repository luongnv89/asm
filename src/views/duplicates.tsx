import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../utils/colors";
import { sortInstancesForKeep, reasonLabel } from "../auditor";
import type { AuditReport, DuplicateGroup, SkillInfo } from "../utils/types";

export interface DuplicatesProps {
  report: AuditReport;
  onRemove: (toRemove: SkillInfo[], keptSkill: SkillInfo) => Promise<void>;
  onClose: () => void;
}

type Phase = "groups" | "instances";

export function DuplicatesView({ report, onRemove, onClose }: DuplicatesProps) {
  const [phase, setPhase] = useState<Phase>("groups");
  const [groupIndex, setGroupIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [markedForRemoval, setMarkedForRemoval] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);

  const groups = report.duplicateGroups;
  const currentGroup: DuplicateGroup | undefined = groups[groupIndex];
  const sortedInstances = useMemo(() => {
    if (!currentGroup) return [] as SkillInfo[];
    return sortInstancesForKeep(currentGroup.instances);
  }, [currentGroup]);

  const optionCount =
    phase === "groups" ? groups.length : sortedInstances.length + 1;

  // NOTE: this handler must stay mounted while `busy` — do NOT gate it with
  // `{ isActive: !busy }`. ink reference-counts raw mode, and the parent App
  // disables its own `useInput` while the audit view is open. Releasing this
  // one too would drop the count to zero for the whole duration of the await,
  // making ink run its full stdin teardown (`setRawMode(false)`, drop the
  // 'readable' listener, `unref()`). On Windows, re-enabling raw mode after
  // that teardown has spanned event-loop turns leaves stdin permanently
  // silent: the process stays alive and idle but never sees another keypress.
  // The `if (busy) return` guard below is what ignores keys during removal.
  useInput(async (_input, key) => {
    if (busy) return;
    if (key.escape) {
      if (phase === "instances") {
        setPhase("groups");
        setCursor(0);
        setMarkedForRemoval(new Set());
        return;
      }
      onClose();
      return;
    }
    if (optionCount === 0) return;
    if (key.upArrow) {
      setCursor((i) => (i <= 0 ? optionCount - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((i) => (i >= optionCount - 1 ? 0 : i + 1));
      return;
    }
    if (key.return) {
      if (phase === "groups") {
        if (groups[cursor]) {
          const group = groups[cursor];
          const sorted = sortInstancesForKeep(group.instances);
          const preMarked = new Set<string>();
          for (let i = 1; i < sorted.length; i++) {
            preMarked.add(sorted[i].path);
          }
          setGroupIndex(cursor);
          setMarkedForRemoval(preMarked);
          setCursor(0);
          setPhase("instances");
        }
        return;
      }
      // Phase: instances
      if (cursor < sortedInstances.length) {
        // Toggle checkbox
        const skillPath = sortedInstances[cursor].path;
        setMarkedForRemoval((prev) => {
          const next = new Set(prev);
          if (next.has(skillPath)) {
            next.delete(skillPath);
          } else {
            // Guard: don't allow marking ALL instances
            if (next.size >= sortedInstances.length - 1) return prev;
            next.add(skillPath);
          }
          return next;
        });
        return;
      }
      // Action row → execute removal
      if (markedForRemoval.size === 0) return;
      const toRemove = sortedInstances.filter((s) =>
        markedForRemoval.has(s.path),
      );
      const kept = sortedInstances.find((s) => !markedForRemoval.has(s.path));
      if (!kept) return;
      setBusy(true);
      try {
        await onRemove(toRemove, kept);
      } finally {
        setBusy(false);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.yellow}
      paddingX={1}
      width={72}
    >
      <Box justifyContent="center">
        <Text color={theme.yellow}>
          {` Audit: Duplicates (${groups.length} groups) `}
        </Text>
      </Box>
      {phase === "groups" ? (
        <GroupsPhase groups={groups} cursor={cursor} />
      ) : (
        <InstancesPhase
          group={currentGroup!}
          sorted={sortedInstances}
          cursor={cursor}
          marked={markedForRemoval}
        />
      )}
      {busy && <Text color={theme.fgDim}>Working…</Text>}
    </Box>
  );
}

function GroupsPhase({
  groups,
  cursor,
}: {
  groups: DuplicateGroup[];
  cursor: number;
}) {
  if (groups.length === 0) {
    return (
      <>
        <Text color={theme.green}>No duplicates found.</Text>
        <Text color={theme.fgDim}> Esc Close</Text>
      </>
    );
  }
  return (
    <>
      <Text color={theme.fgDim}>
        Select a group to inspect and manage instances:
      </Text>
      {groups.map((g, i) => {
        const isSelected = i === cursor;
        const locations = g.instances.map((s) => s.location).join(", ");
        const label = `[${reasonLabel(g.reason)}] ${g.key}  (${g.instances.length} copies: ${locations})`;
        return (
          <Text
            key={`group-${g.key}`}
            color={isSelected ? theme.accent : theme.fg}
            inverse={isSelected}
          >
            {isSelected ? "❯ " : "  "}
            {label}
          </Text>
        );
      })}
      <Text color={theme.fgDim}> Enter Inspect group Esc Close</Text>
    </>
  );
}

function InstancesPhase({
  group,
  sorted,
  cursor,
  marked,
}: {
  group: DuplicateGroup;
  sorted: SkillInfo[];
  cursor: number;
  marked: Set<string>;
}) {
  const markedCount = marked.size;
  const actionLabel =
    markedCount > 0
      ? `  >>> Remove ${markedCount} marked instance(s) <<<`
      : "  (no instances marked for removal)";
  return (
    <>
      <Text color={theme.yellow}>
        Group: &quot;{group.key}&quot; ({reasonLabel(group.reason)}) - Toggle
        instances to remove:
      </Text>
      {sorted.map((s, i) => {
        const checked = marked.has(s.path) ? "[x]" : "[ ]";
        const keepHint = i === 0 && !marked.has(s.path) ? " (keep)" : "";
        const isSelected = i === cursor;
        return (
          <Text
            key={`inst-${s.path}`}
            color={isSelected ? theme.accent : theme.fg}
            inverse={isSelected}
          >
            {isSelected ? "❯ " : "  "}
            {checked} {s.providerLabel}/{s.scope} - {s.path}
            {keepHint}
          </Text>
        );
      })}
      <Text
        color={cursor === sorted.length ? theme.accent : theme.fgDim}
        inverse={cursor === sorted.length}
      >
        {cursor === sorted.length ? "❯ " : "  "}
        {actionLabel}
      </Text>
      <Text color={theme.fgDim}> Enter Toggle/Remove Esc Back to groups</Text>
    </>
  );
}

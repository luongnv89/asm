import React from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";
import { theme } from "../utils/colors";
import { resolveProviderPath } from "../config";
import type { ProviderConfig } from "../utils/types";

export interface LinkTargetOption {
  provider: ProviderConfig;
  label: string;
  targetDir: string;
}

export function buildLinkOptions(
  providers: ProviderConfig[],
  scope: "global" | "project",
): LinkTargetOption[] {
  return providers
    .filter((p) => p.enabled)
    .map((p) => ({
      provider: p,
      label: `${p.label} (${scope === "global" ? p.global : p.project})`,
      targetDir: resolveProviderPath(scope === "global" ? p.global : p.project),
    }));
}

export interface LinkModalProps {
  skillName: string;
  scope: "global" | "project";
  options: LinkTargetOption[];
  onSelect: (option: LinkTargetOption) => void;
  onCancel: () => void;
}

export function LinkModal({
  skillName,
  scope,
  options,
  onSelect,
  onCancel,
}: LinkModalProps) {
  useEscapeKey(onCancel);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      width={60}
    >
      <Box justifyContent="center">
        <Text color={theme.accent}>
          {" "}
          Link to {scope === "project" ? "Project" : "Global"}: {skillName}{" "}
        </Text>
      </Box>
      <Select
        visibleOptionCount={7}
        options={options.map((o, i) => ({
          label: o.label,
          value: String(i),
        }))}
        onChange={(value) => onSelect(options[Number(value)])}
      />
      <Box marginTop={1}>
        <Text color={theme.fgDim}>Enter link · Esc cancel</Text>
      </Box>
    </Box>
  );
}

function useEscapeKey(onCancel: () => void): void {
  useInput(
    (input, key) => {
      if (key.escape) onCancel();
    },
    { isActive: true },
  );
}

import React from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import { theme } from "../utils/colors";
import type { SkillInfo } from "../utils/types";
import { stripControlBytes } from "../utils/control-chars";

export interface ConfirmProps {
  skill: SkillInfo;
  targets: string[];
  onResult: (confirmed: boolean) => void;
}

export function ConfirmView({ skill, targets, onResult }: ConfirmProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.red}
      paddingX={1}
      width={60}
    >
      <Box justifyContent="center">
        <Text color={theme.red}>
          {" "}
          Uninstall: {stripControlBytes(skill.name)}{" "}
        </Text>
      </Box>
      <Text color={theme.yellow}>The following will be removed:</Text>
      <Box flexDirection="column" paddingLeft={1}>
        {targets.length === 0 ? (
          <Text color={theme.fgDim}> (no files found to remove)</Text>
        ) : (
          targets.map((t, i) => (
            <Text key={`target-${i}`} color={theme.red}>
              ✗ {stripControlBytes(t)}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Select
          defaultValue="cancel"
          options={[
            { label: "Yes, uninstall", value: "yes" },
            { label: "Cancel", value: "cancel" },
          ]}
          onChange={(value) => onResult(value === "yes")}
        />
      </Box>
    </Box>
  );
}

import React from "react";
import { Box, Text } from "ink";
import { theme } from "../utils/colors";
import { getVersionString } from "../utils/version";

const KEYBINDINGS: Array<[string, string]> = [
  ["↑ / k", "Move up"],
  ["↓ / j", "Move down"],
  ["Enter", "View skill details"],
  ["d", "Uninstall skill"],
  ["a", "Audit duplicates"],
  ["/", "Search / filter"],
  ["Esc", "Back / clear filter"],
  ["Tab", "Cycle scope"],
  ["s", "Cycle sort order"],
  ["r", "Refresh / rescan skills"],
  ["c", "Open configuration"],
  ["?", "Toggle this help"],
  ["q", "Quit"],
];

export function HelpView() {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      paddingY={0}
      width={44}
    >
      <Box justifyContent="center">
        <Text color={theme.accent}> Keyboard Shortcuts </Text>
      </Box>
      {KEYBINDINGS.map(([key, action]) => (
        <Box key={key} flexDirection="row">
          <Box width={14}>
            <Text color={theme.cyan}>{key}</Text>
          </Box>
          <Text color={theme.fg}>{action}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.fgDim}>Press ? or Esc to close</Text>
      </Box>
      <Box>
        <Text color={theme.fgDim}>{getVersionString()}</Text>
      </Box>
    </Box>
  );
}

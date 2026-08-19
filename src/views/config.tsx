import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../utils/colors";
import { getConfigPath } from "../config";
import type { AppConfig } from "../utils/types";

function providerRow(
  label: string,
  globalPath: string,
  enabled: boolean,
): string {
  const status = enabled ? "✔ ON " : "✘ OFF";
  const name = label.length > 14 ? label.slice(0, 14) : label;
  return `${status}  ${name.padEnd(15)} ${globalPath}`;
}

export interface ConfigProps {
  config: AppConfig;
  onClose: (updatedConfig: AppConfig) => void;
  onOpenEditor: () => void;
}

export function ConfigView({ config, onClose, onOpenEditor }: ConfigProps) {
  const [editConfig, setEditConfig] = useState<AppConfig>(() =>
    JSON.parse(JSON.stringify(config)),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keep edit state in sync when parent swaps the config identity
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync edit state when parent swaps config identity
    setEditConfig(JSON.parse(JSON.stringify(config)));
  }, [config]);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) =>
        i <= 0 ? editConfig.providers.length - 1 : i - 1,
      );
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) =>
        i >= editConfig.providers.length - 1 ? 0 : i + 1,
      );
      return;
    }
    if (key.return) {
      setEditConfig((prev) => {
        const next = { ...prev, providers: [...prev.providers] };
        next.providers[selectedIndex] = {
          ...next.providers[selectedIndex],
          enabled: !next.providers[selectedIndex].enabled,
        };
        return next;
      });
      return;
    }
    if (_input === "e") {
      onOpenEditor();
      return;
    }
    if (key.escape) {
      onClose(editConfig);
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      width={72}
    >
      <Box justifyContent="center">
        <Text color={theme.accent}> Configuration </Text>
      </Box>
      <Text color={theme.fgDim}>Config: {getConfigPath()}</Text>
      <Text color={theme.yellow}>
        Tools (Enter to toggle, e to edit config file):
      </Text>
      {editConfig.providers.map((p, i) => {
        const row = providerRow(p.label, p.global, p.enabled);
        const isSelected = i === selectedIndex;
        const statusColor = p.enabled ? theme.green : theme.red;
        return (
          <Box flexDirection="column" key={`prov-${p.name}`}>
            <Text
              color={isSelected ? theme.accent : statusColor}
              inverse={isSelected}
            >
              {isSelected ? "❯ " : "  "}
              {row}
            </Text>
            {isSelected && (
              <Text color={theme.fgDim}> Project: {p.project}</Text>
            )}
          </Box>
        );
      })}

      {editConfig.customPaths.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text color={theme.yellow}>Custom Paths:</Text>
          </Box>
          {editConfig.customPaths.map((cp, i) => (
            <Text key={`custom-${i}`} color={theme.fg}>
              {"  "}
              {cp.label}: {cp.path} ({cp.scope})
            </Text>
          ))}
        </>
      )}

      <Box marginTop={1}>
        <Text color={theme.fgDim}>
          Defaults: scope={editConfig.preferences.defaultScope}, sort=
          {editConfig.preferences.defaultSort}
        </Text>
      </Box>
      <Text color={theme.fgDim}>Enter Toggle e Edit file Esc Save & close</Text>
    </Box>
  );
}

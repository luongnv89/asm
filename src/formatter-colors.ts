// Split from formatter-core.ts (issue #677).

// ─── Color helpers ──────────────────────────────────────────────────────────

export const useColor = (): boolean => {
  if (process.env.NO_COLOR !== undefined) return false;
  if (globalThis.__CLI_NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
};

const ansi = {
  bold: (s: string) => (useColor() ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor() ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (useColor() ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor() ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s),
  white: (s: string) => (useColor() ? `\x1b[37m${s}\x1b[0m` : s),
  red: (s: string) => (useColor() ? `\x1b[31m${s}\x1b[0m` : s),
  blue: (s: string) => (useColor() ? `\x1b[34m${s}\x1b[0m` : s),
  blueBold: (s: string) => (useColor() ? `\x1b[34;1m${s}\x1b[0m` : s),
  magenta: (s: string) => (useColor() ? `\x1b[35m${s}\x1b[0m` : s),
  bgDim: (s: string) => (useColor() ? `\x1b[48;5;236m${s}\x1b[0m` : s),
  bgRed: (s: string) => (useColor() ? `\x1b[41m\x1b[37m\x1b[1m${s}\x1b[0m` : s),
  bgYellow: (s: string) =>
    useColor() ? `\x1b[43m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
  bgGreen: (s: string) =>
    useColor() ? `\x1b[42m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
  bgCyan: (s: string) =>
    useColor() ? `\x1b[46m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
};

export { ansi };

// ─── Effort colors ─────────────────────────────────────────────────────────

export function colorEffort(effort: string | undefined): string {
  if (!effort) return "";
  switch (effort.toLowerCase()) {
    case "low":
      return ansi.green(effort);
    case "medium":
      return ansi.yellow(effort);
    case "high":
      return ansi.red(effort);
    case "max":
      return ansi.magenta(effort);
    default:
      return effort;
  }
}

// ─── Provider colors ───────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, (s: string) => string> = {
  claude: ansi.blueBold,
  codex: ansi.cyan,
  "codex-plugin": ansi.cyan,
  openclaw: ansi.yellow,
  agents: ansi.green,
  custom: ansi.magenta,
  cursor: ansi.blue,
  windsurf: ansi.cyan,
  cline: ansi.green,
  roocode: ansi.magenta,
  continue: ansi.yellow,
  copilot: ansi.white,
  aider: ansi.red,
  opencode: ansi.cyan,
  zed: ansi.blue,
  augment: ansi.green,
  amp: ansi.yellow,
};

export function colorProvider(provider: string, label: string): string {
  const colorFn = PROVIDER_COLORS[provider] || ansi.dim;
  return colorFn(label);
}

export function providerBadge(provider: string, label: string): string {
  if (!useColor()) return `[${label}]`;
  const colorFn = PROVIDER_COLORS[provider] || ansi.dim;
  return colorFn(`[${label}]`);
}

// ─── Allowed-tools risk coloring ────────────────────────────────────────────

export const HIGH_RISK_TOOLS = new Set([
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
]);
export const MEDIUM_RISK_TOOLS = new Set(["WebFetch", "WebSearch"]);

export function colorTool(tool: string): string {
  if (HIGH_RISK_TOOLS.has(tool)) return ansi.red(tool);
  if (MEDIUM_RISK_TOOLS.has(tool)) return ansi.yellow(tool);
  return ansi.green(tool);
}

export function formatAllowedTools(tools: string[]): string {
  if (tools.length === 0) return "";
  return tools.map(colorTool).join("  ");
}

export function toolRiskWarning(tools: string[]): string | null {
  const high = tools.filter((t) => HIGH_RISK_TOOLS.has(t));
  if (high.length === 0) return null;
  const actions: string[] = [];
  if (high.includes("Bash")) actions.push("execute shell commands");
  if (
    high.includes("Write") ||
    high.includes("Edit") ||
    high.includes("NotebookEdit")
  )
    actions.push("modify files");
  return `This skill can ${actions.join(" and ")}`;
}

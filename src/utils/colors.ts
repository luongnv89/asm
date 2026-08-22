/**
 * Shared semantic palette for CLI (ANSI) and TUI (Ink hex).
 *
 * Default is a dark-tuned Okabe–Ito set. Status is dual-encoded in callers
 * (words/glyphs plus hue). --no-color / NO_COLOR still strip all SGR.
 */

export type ColorRole =
  | "fg"
  | "dim"
  | "border"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "special";

/** Dark-tuned Okabe–Ito default. */
export const roles: Record<ColorRole, string> = {
  fg: "#E8E8E8",
  dim: "#9A9A9A",
  border: "#6B6B6B",
  accent: "#56B4E9",
  success: "#2BC48A",
  warning: "#E69F00",
  danger: "#D55E00",
  special: "#CC79A7",
};

/** 16-color SGR foreground codes when COLORTERM is not truecolor/24bit. */
const ANSI16: Record<ColorRole, number> = {
  fg: 37,
  dim: 90,
  border: 90,
  accent: 36,
  success: 32,
  warning: 33,
  danger: 31,
  special: 35,
};

export function useColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (globalThis.__CLI_NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

export function useTrueColor(): boolean {
  const ct = (process.env.COLORTERM ?? "").toLowerCase();
  return ct === "truecolor" || ct === "24bit";
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function paint(role: ColorRole, s: string): string {
  if (!useColor()) return s;
  if (useTrueColor()) {
    const [r, g, b] = hexToRgb(roles[role]);
    return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
  }
  return `\x1b[${ANSI16[role]}m${s}\x1b[0m`;
}

export const ansi = {
  bold: (s: string) => (useColor() ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => paint("accent", s),
  green: (s: string) => paint("success", s),
  yellow: (s: string) => paint("warning", s),
  dim: (s: string) => paint("dim", s),
  white: (s: string) => paint("fg", s),
  red: (s: string) => paint("danger", s),
  blue: (s: string) => paint("accent", s),
  blueBold: (s: string) => {
    if (!useColor()) return s;
    if (useTrueColor()) {
      const [r, g, b] = hexToRgb(roles.accent);
      return `\x1b[1;38;2;${r};${g};${b}m${s}\x1b[0m`;
    }
    return `\x1b[36;1m${s}\x1b[0m`;
  },
  magenta: (s: string) => paint("special", s),
  bgDim: (s: string) => (useColor() ? `\x1b[48;5;236m${s}\x1b[0m` : s),
  bgRed: (s: string) =>
    useColor() ? `\x1b[41m\x1b[37m\x1b[1m${s}\x1b[0m` : s,
  bgYellow: (s: string) =>
    useColor() ? `\x1b[43m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
  bgGreen: (s: string) =>
    useColor() ? `\x1b[42m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
  bgCyan: (s: string) =>
    useColor() ? `\x1b[46m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
};

/** Ink TUI tokens. Legacy keys alias the Okabe–Ito roles. */
export const theme = {
  bg: "#1a1b26",
  bgAlt: "#24283b",
  fg: roles.fg,
  fgDim: roles.dim,
  accent: roles.accent,
  accentAlt: roles.special,
  green: roles.success,
  red: roles.danger,
  yellow: roles.warning,
  cyan: roles.accent,
  orange: roles.warning,
  border: roles.border,
  borderFocus: roles.accent,
  white: "#FFFFFF",
} as const;

/** Selected-row style: muted navy wash, light text. Never inverse, never a neon bar. */
export const selectedFill = {
  color: theme.fg,
  backgroundColor: theme.bgAlt,
} as const;

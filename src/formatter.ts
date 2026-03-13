import type { SkillInfo } from "./utils/types";
import { countFiles } from "./scanner";

// ─── Color helpers ──────────────────────────────────────────────────────────

const useColor = (): boolean => {
  if (process.env.NO_COLOR !== undefined) return false;
  if ((globalThis as any).__CLI_NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
};

const ansi = {
  bold: (s: string) => (useColor() ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor() ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (useColor() ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor() ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (useColor() ? `\x1b[31m${s}\x1b[0m` : s),
  blueBold: (s: string) => (useColor() ? `\x1b[1m\x1b[34m${s}\x1b[0m` : s),
};

export { ansi };

// ─── Table formatter ────────────────────────────────────────────────────────

export function formatSkillTable(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return "No skills found.";
  }

  const headers = ["Name", "Version", "Provider", "Scope", "Type", "Path"];

  const rows = skills.map((s) => [
    s.name,
    s.version,
    s.providerLabel,
    s.scope,
    s.isSymlink ? "symlink" : "directory",
    s.path,
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  const pad = (str: string, width: number) => str.padEnd(width);

  const headerLine = headers.map((h, i) => pad(h, widths[i])).join("  ");
  const separator = widths.map((w) => "─".repeat(w)).join("──");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => pad(cell, widths[i])).join("  "),
  );

  return [
    useColor() ? ansi.bold(headerLine) : headerLine,
    separator,
    ...dataLines,
  ].join("\n");
}

// ─── Detail formatter ───────────────────────────────────────────────────────

export async function formatSkillDetail(skill: SkillInfo): Promise<string> {
  const lines: string[] = [];
  const label = (key: string, value: string) =>
    `${useColor() ? ansi.bold(key + ":") : key + ":"} ${value}`;

  lines.push(label("Name", skill.name));
  lines.push(label("Version", skill.version));
  lines.push(label("Provider", skill.providerLabel));
  lines.push(label("Scope", skill.scope));
  lines.push(label("Location", skill.location));
  lines.push(label("Path", skill.path));
  lines.push(label("Type", skill.isSymlink ? "symlink" : "directory"));
  if (skill.isSymlink && skill.symlinkTarget) {
    lines.push(label("Symlink Target", skill.symlinkTarget));
  }
  const fileCount = skill.fileCount ?? (await countFiles(skill.path));
  lines.push(label("File Count", String(fileCount)));
  if (skill.description) {
    lines.push("");
    lines.push(label("Description", skill.description));
  }

  if (skill.warnings && skill.warnings.length > 0) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("Warnings:") : "Warnings:");
    for (const w of skill.warnings) {
      lines.push(
        `  ${useColor() ? ansi.yellow("⚠") : "!"} [${w.category}] ${w.message}`,
      );
    }
  }

  return lines.join("\n");
}

// ─── JSON formatter ─────────────────────────────────────────────────────────

export function formatJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

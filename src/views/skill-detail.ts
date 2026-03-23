import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { RenderContext } from "@opentui/core";
import { theme } from "../utils/colors";
import type { SkillInfo } from "../utils/types";
import { countFiles } from "../scanner";
import { wordWrap, HIGH_RISK_TOOLS, MEDIUM_RISK_TOOLS } from "../formatter";

const EFFORT_COLORS: Record<string, string> = {
  low: theme.green,
  medium: theme.yellow,
  high: theme.red,
  max: theme.accentAlt, // magenta
};

function detailRow(
  ctx: RenderContext,
  id: string,
  label: string,
  value: string,
  valueColor: string = theme.fg,
): BoxRenderable {
  const row = new BoxRenderable(ctx, {
    id: `detail-row-${id}`,
    flexDirection: "row",
    width: "100%",
    height: 1,
  });

  const labelText = new TextRenderable(ctx, {
    content: `${label}:`.padEnd(15),
    fg: theme.fgDim,
    width: 16,
  });

  const valueText = new TextRenderable(ctx, {
    content: value,
    fg: valueColor,
  });

  row.add(labelText);
  row.add(valueText);
  return row;
}

export function createDetailView(
  ctx: RenderContext,
  skill: SkillInfo,
): BoxRenderable {
  const boxWidth = 64;
  const descMaxWidth = 56;
  const desc = skill.description || "(no description)";
  const wrappedDescLines = wordWrap(desc, descMaxWidth);
  // base detail rows (name, version, creator, license, tool, location, path, symlink, files, scope) = 10
  // + optional rows: effort, compatibility, allowed-tools (label + tools + optional warning)
  const effortRows = skill.effort ? 1 : 0;
  const compatRows = skill.compatibility ? 1 : 0;
  const hasHighRiskTools = skill.allowedTools?.some((t) =>
    HIGH_RISK_TOOLS.has(t),
  );
  const toolsRows =
    skill.allowedTools && skill.allowedTools.length > 0
      ? hasHighRiskTools
        ? 3
        : 2
      : 0;
  const boxHeight = Math.min(
    ctx.height - 2,
    10 +
      effortRows +
      compatRows +
      toolsRows +
      2 +
      wrappedDescLines.length +
      2 +
      2 +
      2,
  );
  const top = Math.max(0, Math.floor((ctx.height - boxHeight) / 2));
  const left = Math.max(0, Math.floor((ctx.width - boxWidth) / 2));

  const container = new BoxRenderable(ctx, {
    id: "detail-overlay",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.accent,
    backgroundColor: theme.bgAlt,
    title: ` ${skill.name} `,
    titleAlignment: "center",
    padding: 1,
    flexDirection: "column",
    gap: 0,
    width: boxWidth,
    height: boxHeight,
    position: "absolute",
    top,
    left,
    zIndex: 100,
  });

  container.add(detailRow(ctx, "name", "Name", skill.name, theme.accent));
  container.add(
    detailRow(ctx, "version", "Version", skill.version, theme.green),
  );
  container.add(
    detailRow(
      ctx,
      "creator",
      "Creator",
      skill.creator || "\u2014",
      skill.creator ? theme.fg : theme.fgDim,
    ),
  );
  container.add(
    detailRow(
      ctx,
      "license",
      "License",
      skill.license || "\u2014",
      skill.license ? theme.fg : theme.fgDim,
    ),
  );
  if (skill.compatibility) {
    container.add(
      detailRow(
        ctx,
        "compat",
        "Compatibility",
        skill.compatibility,
        theme.cyan,
      ),
    );
  }
  if (skill.effort) {
    container.add(
      detailRow(
        ctx,
        "effort",
        "Effort",
        skill.effort,
        EFFORT_COLORS[skill.effort.toLowerCase()] || theme.fg,
      ),
    );
  }
  container.add(
    detailRow(ctx, "provider", "Tool", skill.providerLabel, theme.accentAlt),
  );
  container.add(
    detailRow(ctx, "location", "Location", skill.location, theme.cyan),
  );
  container.add(detailRow(ctx, "path", "Path", skill.path));
  container.add(
    detailRow(
      ctx,
      "symlink",
      "Symlink",
      skill.isSymlink ? `yes \u2192 ${skill.symlinkTarget}` : "no",
      skill.isSymlink ? theme.yellow : theme.fgDim,
    ),
  );
  const fileCountDisplay =
    skill.fileCount !== undefined ? String(skill.fileCount) : "...";
  const filesValueText = new TextRenderable(ctx, {
    content: fileCountDisplay,
    fg: theme.fg,
  });
  const filesRow = new BoxRenderable(ctx, {
    id: "detail-row-files",
    flexDirection: "row",
    width: "100%",
    height: 1,
  });
  filesRow.add(
    new TextRenderable(ctx, {
      content: "Files:".padEnd(15),
      fg: theme.fgDim,
      width: 16,
    }),
  );
  filesRow.add(filesValueText);
  container.add(filesRow);

  if (skill.fileCount === undefined) {
    countFiles(skill.path)
      .then((count) => {
        filesValueText.content = String(count);
      })
      .catch(() => {});
  }
  container.add(detailRow(ctx, "scope", "Scope", skill.scope, theme.accentAlt));

  const descLabel = new TextRenderable(ctx, {
    content: "\nDescription:",
    fg: theme.fgDim,
    height: 2,
  });
  container.add(descLabel);

  // Show as many description lines as fit; truncate only if terminal is too small
  const maxDescLines = Math.max(1, boxHeight - 9 - 2 - 2 - 2 - 2);
  const visibleLines = wrappedDescLines.slice(0, maxDescLines);
  if (visibleLines.length < wrappedDescLines.length) {
    const lastLine = visibleLines[visibleLines.length - 1];
    visibleLines[visibleLines.length - 1] =
      lastLine.length > descMaxWidth - 3
        ? lastLine.slice(0, descMaxWidth - 3) + "..."
        : lastLine + "...";
  }
  const descText = new TextRenderable(ctx, {
    content: visibleLines.map((l) => `  ${l}`).join("\n"),
    fg: theme.fg,
    width: 58,
    height: visibleLines.length,
  });
  container.add(descText);

  if (skill.allowedTools && skill.allowedTools.length > 0) {
    const toolsLabel = new TextRenderable(ctx, {
      content: "\nAllowed Tools:",
      fg: theme.fgDim,
      height: 2,
    });
    container.add(toolsLabel);

    // Render each tool with its risk-level color
    const toolsRow = new BoxRenderable(ctx, {
      id: "detail-row-tools",
      flexDirection: "row",
      width: "100%",
      height: 1,
    });
    toolsRow.add(new TextRenderable(ctx, { content: "  ", fg: theme.fg }));
    for (let i = 0; i < skill.allowedTools.length; i++) {
      const t = skill.allowedTools[i];
      let color = theme.green;
      if (HIGH_RISK_TOOLS.has(t)) color = theme.red;
      else if (MEDIUM_RISK_TOOLS.has(t)) color = theme.yellow;
      toolsRow.add(
        new TextRenderable(ctx, {
          content: i < skill.allowedTools.length - 1 ? `${t}  ` : t,
          fg: color,
        }),
      );
    }
    container.add(toolsRow);

    // Warning line for high-risk tools
    const highRisk = skill.allowedTools.filter((t) => HIGH_RISK_TOOLS.has(t));
    if (highRisk.length > 0) {
      const actions: string[] = [];
      if (highRisk.includes("Bash")) actions.push("execute shell commands");
      if (highRisk.some((t) => ["Write", "Edit", "NotebookEdit"].includes(t)))
        actions.push("modify files");
      container.add(
        new TextRenderable(ctx, {
          content: `  ! This skill can ${actions.join(" and ")}`,
          fg: theme.yellow,
        }),
      );
    }
  }

  const footer = new TextRenderable(ctx, {
    content: "\n  Esc Back    d Uninstall",
    fg: theme.fgDim,
  });
  container.add(footer);

  return container;
}

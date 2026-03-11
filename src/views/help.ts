import {
  BoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { RenderContext } from "@opentui/core";
import { theme } from "../utils/colors";

const KEYBINDINGS = [
  ["↑ / k", "Move up"],
  ["↓ / j", "Move down"],
  ["Enter", "View skill details"],
  ["d", "Uninstall skill"],
  ["/", "Search / filter"],
  ["Esc", "Back / clear filter"],
  ["Tab", "Cycle scope"],
  ["s", "Cycle sort order"],
  ["?", "Toggle this help"],
  ["q", "Quit"],
];

export function createHelpView(ctx: RenderContext): BoxRenderable {
  const boxWidth = 44;
  const boxHeight = KEYBINDINGS.length + 6;
  const top = Math.max(0, Math.floor((ctx.height - boxHeight) / 2));
  const left = Math.max(0, Math.floor((ctx.width - boxWidth) / 2));

  const container = new BoxRenderable(ctx, {
    id: "help-overlay",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.accent,
    backgroundColor: theme.bgAlt,
    title: " Keyboard Shortcuts ",
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

  for (const [key, action] of KEYBINDINGS) {
    const row = new BoxRenderable(ctx, {
      id: `help-row-${key}`,
      flexDirection: "row",
      width: "100%",
      height: 1,
    });

    const keyText = new TextRenderable(ctx, {
      content: key.padEnd(12),
      fg: theme.cyan,
      width: 14,
    });

    const actionText = new TextRenderable(ctx, {
      content: action,
      fg: theme.fg,
    });

    row.add(keyText);
    row.add(actionText);
    container.add(row);
  }

  const footer = new TextRenderable(ctx, {
    content: "\n  Press ? or Esc to close",
    fg: theme.fgDim,
  });
  container.add(footer);

  return container;
}

import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
} from "@opentui/core";
import type { RenderContext } from "@opentui/core";
import { theme } from "../utils/colors";
import type { SkillInfo } from "../utils/types";

export interface ConfirmResult {
  confirmed: boolean;
}

export function createConfirmView(
  ctx: RenderContext,
  skill: SkillInfo,
  targets: string[],
  onResult: (result: ConfirmResult) => void,
): BoxRenderable {
  const boxWidth = 60;
  const boxHeight = Math.min(targets.length + 10, 24);
  const top = Math.max(0, Math.floor((ctx.height - boxHeight) / 2));
  const left = Math.max(0, Math.floor((ctx.width - boxWidth) / 2));

  const container = new BoxRenderable(ctx, {
    id: "confirm-overlay",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.red,
    backgroundColor: theme.bgAlt,
    title: ` Uninstall: ${skill.name} `,
    titleAlignment: "center",
    padding: 1,
    flexDirection: "column",
    gap: 1,
    width: boxWidth,
    height: boxHeight,
    position: "absolute",
    top,
    left,
    zIndex: 100,
  });

  const header = new TextRenderable(ctx, {
    content: "The following will be removed:",
    fg: theme.yellow,
  });
  container.add(header);

  const targetBox = new BoxRenderable(ctx, {
    id: "confirm-targets",
    flexDirection: "column",
    width: "100%",
    paddingLeft: 1,
  });

  if (targets.length === 0) {
    const noTargets = new TextRenderable(ctx, {
      content: "  (no files found to remove)",
      fg: theme.fgDim,
    });
    targetBox.add(noTargets);
  } else {
    for (let i = 0; i < targets.length; i++) {
      const targetText = new TextRenderable(ctx, {
        id: `confirm-target-${i}`,
        content: `✗ ${targets[i]}`,
        fg: theme.red,
      });
      targetBox.add(targetText);
    }
  }
  container.add(targetBox);

  const spacer = new TextRenderable(ctx, {
    content: "",
    height: 1,
  });
  container.add(spacer);

  const select = new SelectRenderable(ctx, {
    id: "confirm-select",
    width: 30,
    height: 4,
    options: [
      { name: "Yes, uninstall", description: "", value: "yes" },
      { name: "Cancel", description: "", value: "cancel" },
    ],
    wrapSelection: true,
    selectedIndex: 1,
  });

  (select as any).on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: any) => {
    onResult({ confirmed: option.value === "yes" });
  });

  container.add(select);
  select.focus();

  return container;
}

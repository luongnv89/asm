import { afterEach, describe, expect, test } from "vitest";
import { ansi, paint, roles, useColor, useTrueColor } from "./colors";

const originalIsTTY = process.stdout.isTTY;
const originalColorTerm = process.env.COLORTERM;
const originalNoColor = process.env.NO_COLOR;

function enableColor(truecolor: boolean): void {
  delete process.env.NO_COLOR;
  delete (globalThis as { __CLI_NO_COLOR?: boolean }).__CLI_NO_COLOR;
  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  if (truecolor) process.env.COLORTERM = "truecolor";
  else delete process.env.COLORTERM;
}

afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalIsTTY,
    configurable: true,
  });
  if (originalColorTerm === undefined) delete process.env.COLORTERM;
  else process.env.COLORTERM = originalColorTerm;
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
  delete (globalThis as { __CLI_NO_COLOR?: boolean }).__CLI_NO_COLOR;
});

describe("useColor / useTrueColor", () => {
  test("NO_COLOR disables color even on a TTY", () => {
    enableColor(true);
    process.env.NO_COLOR = "";
    expect(useColor()).toBe(false);
  });

  test("__CLI_NO_COLOR disables color", () => {
    enableColor(true);
    globalThis.__CLI_NO_COLOR = true;
    expect(useColor()).toBe(false);
  });

  test("COLORTERM=truecolor enables 24-bit", () => {
    enableColor(true);
    expect(useTrueColor()).toBe(true);
  });

  test("COLORTERM=24bit enables 24-bit", () => {
    enableColor(false);
    process.env.COLORTERM = "24bit";
    expect(useTrueColor()).toBe(true);
  });

  test("missing COLORTERM is 16-color fallback", () => {
    enableColor(false);
    expect(useTrueColor()).toBe(false);
  });
});

describe("paint", () => {
  test("returns the string unchanged when color is off", () => {
    globalThis.__CLI_NO_COLOR = true;
    expect(paint("danger", "x")).toBe("x");
    expect(ansi.red("x")).toBe("x");
  });

  test("truecolor uses 24-bit SGR from the role hex", () => {
    enableColor(true);
    expect(paint("accent", "hi")).toBe("\x1b[38;2;86;180;233mhi\x1b[0m");
    expect(paint("success", "hi")).toBe("\x1b[38;2;43;196;138mhi\x1b[0m");
    expect(paint("warning", "hi")).toBe("\x1b[38;2;230;159;0mhi\x1b[0m");
    expect(paint("danger", "hi")).toBe("\x1b[38;2;213;94;0mhi\x1b[0m");
    expect(paint("special", "hi")).toBe("\x1b[38;2;204;121;167mhi\x1b[0m");
  });

  test("16-color fallback uses the locked SGR map", () => {
    enableColor(false);
    expect(paint("accent", "hi")).toBe("\x1b[36mhi\x1b[0m");
    expect(paint("success", "hi")).toBe("\x1b[32mhi\x1b[0m");
    expect(paint("warning", "hi")).toBe("\x1b[33mhi\x1b[0m");
    expect(paint("danger", "hi")).toBe("\x1b[31mhi\x1b[0m");
    expect(paint("special", "hi")).toBe("\x1b[35mhi\x1b[0m");
  });

  test("role hex values match the locked Q10 map", () => {
    expect(roles.accent).toBe("#56B4E9");
    expect(roles.success).toBe("#2BC48A");
    expect(roles.warning).toBe("#E69F00");
    expect(roles.danger).toBe("#D55E00");
    expect(roles.special).toBe("#CC79A7");
    expect(roles.fg).toBe("#E8E8E8");
    expect(roles.dim).toBe("#9A9A9A");
    expect(roles.border).toBe("#6B6B6B");
  });
});

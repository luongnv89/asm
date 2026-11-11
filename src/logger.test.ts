import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { setVerbose, isVerbose, debug } from "./logger";

describe("logger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setVerbose(false);
    (globalThis as any).__CLI_NO_COLOR = false;
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    (globalThis as any).__CLI_NO_COLOR = false;
  });

  test("isVerbose returns false by default", () => {
    expect(isVerbose()).toBe(false);
  });

  test("setVerbose(true) enables verbose mode", () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });

  test("setVerbose(false) disables verbose mode", () => {
    setVerbose(true);
    setVerbose(false);
    expect(isVerbose()).toBe(false);
  });

  test("debug() is silent when verbose is off", () => {
    debug("test message");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test("debug() emits to stderr when verbose is on", () => {
    setVerbose(true);
    debug("scanning directories");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[verbose]");
    expect(output).toContain("scanning directories");
  });

  test("debug() includes timing info (+Nms)", () => {
    setVerbose(true);
    debug("timing test");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/\+\d+ms/);
  });

  test("debug() includes ANSI dim codes by default", () => {
    setVerbose(true);
    debug("color test");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("\x1b[2m");
    expect(output).toContain("\x1b[0m");
  });

  test("debug() omits ANSI codes when __CLI_NO_COLOR is set", () => {
    (globalThis as any).__CLI_NO_COLOR = true;
    setVerbose(true);
    debug("no color test");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).not.toContain("\x1b[");
    expect(output).toContain("[verbose]");
    expect(output).toContain("no color test");
  });

  test("debug() strips control bytes and keeps each message on one line (#830)", () => {
    (globalThis as any).__CLI_NO_COLOR = true;
    setVerbose(true);
    debug("skip: evil\x1b[31m\x07\u009b\x7f\nnext\r\tend");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/skip: evil\?\[31m\?\?\?\\nnext\\r\tend$/);
    expect(output).not.toContain("\n");
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/);
  });

  test("an author folder name cannot forge a [verbose] line (#830)", () => {
    (globalThis as any).__CLI_NO_COLOR = true;
    setVerbose(true);
    debug(
      "scanner: skipped nofile\n[verbose] +1ms FORGED all clear (no SKILL.md)",
    );
    const output = stderrSpy.mock.calls[0][0] as string;
    const lines = output.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("[verbose] +1ms FORGED"))).toEqual(
      [],
    );
    expect(output).toContain("nofile\\n[verbose] +1ms FORGED all clear");
  });
});

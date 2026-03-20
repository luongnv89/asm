import { describe, it, expect } from "bun:test";
import { parseEditorCommand } from "./editor";

describe("parseEditorCommand", () => {
  it("returns ['vi', []] for empty string", () => {
    expect(parseEditorCommand("")).toEqual(["vi", []]);
  });

  it("returns ['vi', []] for whitespace-only string", () => {
    expect(parseEditorCommand("   ")).toEqual(["vi", []]);
  });

  it("parses a bare editor with no args", () => {
    expect(parseEditorCommand("vim")).toEqual(["vim", []]);
  });

  it("parses a bare editor with leading/trailing whitespace", () => {
    expect(parseEditorCommand("  nano  ")).toEqual(["nano", []]);
  });

  it("splits on spaces into executable + args", () => {
    expect(parseEditorCommand("code --wait")).toEqual(["code", ["--wait"]]);
  });

  it("splits multiple space-separated args", () => {
    expect(parseEditorCommand("emacsclient --tty -a")).toEqual([
      "emacsclient",
      ["--tty", "-a"],
    ]);
  });

  it("collapses multiple spaces between tokens", () => {
    expect(parseEditorCommand("vim  --noplugin")).toEqual([
      "vim",
      ["--noplugin"],
    ]);
  });

  it("handles tab-separated tokens", () => {
    expect(parseEditorCommand("vim\t--noplugin")).toEqual([
      "vim",
      ["--noplugin"],
    ]);
  });

  it("handles double-quoted empty string argument", () => {
    expect(parseEditorCommand('emacsclient --tty -a ""')).toEqual([
      "emacsclient",
      ["--tty", "-a", ""],
    ]);
  });

  it("handles double-quoted argument with spaces", () => {
    expect(parseEditorCommand('editor --title "My File"')).toEqual([
      "editor",
      ["--title", "My File"],
    ]);
  });

  it("handles escaped double-quote inside double-quoted arg", () => {
    expect(parseEditorCommand('editor --arg "say \\"hi\\""')).toEqual([
      "editor",
      ["--arg", 'say "hi"'],
    ]);
  });

  it("handles escaped backslash inside double-quoted arg", () => {
    expect(parseEditorCommand('editor "C:\\\\path"')).toEqual([
      "editor",
      ["C:\\path"],
    ]);
  });

  it("handles double-quoted executable path with spaces", () => {
    expect(parseEditorCommand('"/usr/local/bin/my editor" --wait')).toEqual([
      "/usr/local/bin/my editor",
      ["--wait"],
    ]);
  });

  it("handles single-quoted empty string argument", () => {
    expect(parseEditorCommand("emacsclient --tty -a ''")).toEqual([
      "emacsclient",
      ["--tty", "-a", ""],
    ]);
  });

  it("handles single-quoted argument with spaces", () => {
    expect(parseEditorCommand("editor --title 'My File'")).toEqual([
      "editor",
      ["--title", "My File"],
    ]);
  });

  it("preserves backslash literally inside single-quoted arg", () => {
    expect(parseEditorCommand("editor 'C:\\path'")).toEqual([
      "editor",
      ["C:\\path"],
    ]);
  });

  it("concatenates adjacent quoted and unquoted segments", () => {
    expect(parseEditorCommand("editor --opt='value'")).toEqual([
      "editor",
      ["--opt=value"],
    ]);
  });

  it("treats unterminated double-quote as if closed at end of input", () => {
    expect(parseEditorCommand('editor "unclosed')).toEqual([
      "editor",
      ["unclosed"],
    ]);
  });

  it("treats unterminated single-quote as if closed at end of input", () => {
    expect(parseEditorCommand("editor 'unclosed")).toEqual([
      "editor",
      ["unclosed"],
    ]);
  });

  it('real-world: emacsclient --tty -a ""', () => {
    expect(parseEditorCommand('emacsclient --tty -a ""')).toEqual([
      "emacsclient",
      ["--tty", "-a", ""],
    ]);
  });

  it("real-world: subl --wait --new-window", () => {
    expect(parseEditorCommand("subl --wait --new-window")).toEqual([
      "subl",
      ["--wait", "--new-window"],
    ]);
  });
});

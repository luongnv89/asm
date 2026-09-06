import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { parseArgs } from "../cli";
import { cmdBundle } from "./bundle";

// Issue #629 — the bundle install tool/scope pickers must be discoverable in
// `--help` and must abort gracefully when dismissed.

const mocks = vi.hoisted(() => ({
  loadBundle: vi.fn(),
  resolveProvider: vi.fn(),
  promptInstallScope: vi.fn(),
  selectBundleSkills: vi.fn(),
  readLine: vi.fn(),
}));

vi.mock("../bundler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bundler")>()),
  loadBundle: (...a: unknown[]) => mocks.loadBundle(...a),
}));
vi.mock("../installer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../installer")>()),
  resolveProvider: (...a: unknown[]) => mocks.resolveProvider(...a),
}));
vi.mock("./install-prompts", () => ({
  promptInstallScope: (...a: unknown[]) => mocks.promptInstallScope(...a),
  selectBundleSkills: (...a: unknown[]) => mocks.selectBundleSkills(...a),
}));
vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared")>()),
  readLine: (...a: unknown[]) => mocks.readLine(...a),
}));

const provider = {
  name: "claude",
  label: "Claude Code",
  global: "/tmp/asm-global",
  project: "/tmp/asm-project",
  enabled: true,
};

class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

let out: string[];
let err: string[];
const origIsTTY = process.stdin.isTTY;

function setTTY(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);

  mocks.loadBundle.mockResolvedValue({
    name: "demo",
    description: "demo bundle",
    skills: [{ name: "skill-a", installUrl: "/tmp/skill-a" }],
  });
  mocks.resolveProvider.mockResolvedValue({ provider, allProviders: null });
  mocks.promptInstallScope.mockResolvedValue("global");
  mocks.selectBundleSkills.mockImplementation(
    async (skills: unknown) => skills,
  );
  mocks.readLine.mockResolvedValue("n");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setTTY(origIsTTY);
});

describe("bundle help discoverability (#629)", () => {
  test("`bundle install --help` documents -p/--tool and the install scope", async () => {
    await cmdBundle(parseArgs(["node", "asm", "bundle", "install", "--help"]));
    const help = out.join("\n");
    expect(help).toContain("-p, --tool <name>");
    expect(help).toMatch(/-s, --scope[\s\S]*install scope/);
    // The old text called scope a plain "Filter", hiding the install meaning.
    expect(help).not.toMatch(/-s, --scope <s>\s+Filter:/);
    expect(help).toContain("Interactive install:");
    expect(help).toMatch(/prompts for the tool\(s\)/);
    expect(help).toMatch(/-p\/--tool for the tool picker/);
    // `-y` does not skip the tool picker — resolveProvider has no `yes` gate.
    expect(help).not.toMatch(/--yes.*all interactive pickers/);
    // Nor does piped input skip them: non-TTY runs require -p/--tool.
    expect(help).not.toMatch(/[Pp]iped input skips/);
  });
});

describe("bundle install picker dismissal (#629)", () => {
  test("dismissing the tool picker aborts gracefully", async () => {
    setTTY(true);
    mocks.resolveProvider.mockRejectedValue(
      new Error("No tools selected. Aborting."),
    );

    await expect(
      cmdBundle(parseArgs(["node", "asm", "bundle", "install", "demo"])),
    ).rejects.toBeInstanceOf(ExitError);

    expect(err.join("\n")).toContain("No tools selected. Aborting.");
  });

  test("dismissing the scope picker aborts gracefully", async () => {
    setTTY(true);
    mocks.promptInstallScope.mockRejectedValue(
      new Error("No scope selected. Aborting."),
    );

    await expect(
      cmdBundle(parseArgs(["node", "asm", "bundle", "install", "demo"])),
    ).rejects.toBeInstanceOf(ExitError);

    expect(err.join("\n")).toContain("No scope selected. Aborting.");
  });

  test("TTY run without flags prompts for tool, then scope", async () => {
    setTTY(true);

    await expect(
      cmdBundle(parseArgs(["node", "asm", "bundle", "install", "demo"])),
    ).rejects.toBeInstanceOf(ExitError);

    expect(mocks.resolveProvider).toHaveBeenCalledWith(
      expect.anything(),
      null,
      true,
    );
    expect(mocks.promptInstallScope).toHaveBeenCalledWith(
      expect.objectContaining({ scopeFlag: "both", isTTY: true, yes: false }),
    );
    expect(mocks.resolveProvider.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.promptInstallScope.mock.invocationCallOrder[0],
    );
  });
});

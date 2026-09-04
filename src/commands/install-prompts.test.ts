import { describe, test, expect, beforeEach, vi } from "vitest";
import { promptInstallScope, selectBundleSkills } from "./install-prompts";
import type { BundleSkillRef, ProviderConfig } from "../utils/types";

const mocks = vi.hoisted(() => ({
  checkboxPicker: vi.fn<(opts: any) => Promise<number[]>>(() =>
    Promise.resolve([]),
  ),
}));
vi.mock("../utils/checkbox-picker", () => ({
  checkboxPicker: (opts: unknown) => mocks.checkboxPicker(opts),
}));

const provider: ProviderConfig = {
  name: "claude",
  label: "Claude Code",
  global: "/tmp/asm-global",
  project: "/tmp/asm-project",
  enabled: true,
};

function bundleSkills(): BundleSkillRef[] {
  return [
    { name: "skill-a", installUrl: "/tmp/skill-a" },
    { name: "skill-b", installUrl: "/tmp/skill-b" },
  ];
}

beforeEach(() => {
  mocks.checkboxPicker.mockReset();
  mocks.checkboxPicker.mockResolvedValue([]);
});

// ─── selectBundleSkills ──────────────────────────────────────────────────────

describe("selectBundleSkills", () => {
  test("non-TTY installs all without prompting", async () => {
    const skills = bundleSkills();
    const result = await selectBundleSkills(skills, {
      isTTY: false,
      yes: false,
    });
    expect(result).toEqual(skills);
    expect(mocks.checkboxPicker).not.toHaveBeenCalled();
  });

  test("--yes installs all without prompting", async () => {
    const skills = bundleSkills();
    const result = await selectBundleSkills(skills, {
      isTTY: true,
      yes: true,
    });
    expect(result).toEqual(skills);
    expect(mocks.checkboxPicker).not.toHaveBeenCalled();
  });

  test("single-skill bundle installs without prompting", async () => {
    const skills = bundleSkills().slice(0, 1);
    const result = await selectBundleSkills(skills, {
      isTTY: true,
      yes: false,
    });
    expect(result).toEqual(skills);
    expect(mocks.checkboxPicker).not.toHaveBeenCalled();
  });

  test("TTY multi-skill bundle returns only picked entries", async () => {
    mocks.checkboxPicker.mockResolvedValueOnce([1]);
    const result = await selectBundleSkills(bundleSkills(), {
      isTTY: true,
      yes: false,
    });
    expect(result).toEqual([bundleSkills()[1]]);
    expect(mocks.checkboxPicker).toHaveBeenCalledOnce();
  });

  test("dismissed picker throws", async () => {
    mocks.checkboxPicker.mockResolvedValueOnce([]);
    await expect(
      selectBundleSkills(bundleSkills(), { isTTY: true, yes: false }),
    ).rejects.toThrow("No skills selected");
  });
});

// ─── promptInstallScope ──────────────────────────────────────────────────────

describe("promptInstallScope", () => {
  test("explicit --scope global wins without prompting", async () => {
    const logs: string[] = [];
    const scope = await promptInstallScope({
      scopeFlag: "global",
      provider,
      isTTY: true,
      yes: false,
      log: (m) => logs.push(m),
    });
    expect(scope).toBe("global");
    expect(mocks.checkboxPicker).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("scope: global");
  });

  test("explicit --scope project wins without prompting", async () => {
    const scope = await promptInstallScope({
      scopeFlag: "project",
      provider,
      isTTY: true,
      yes: false,
      log: () => {},
    });
    expect(scope).toBe("project");
    expect(mocks.checkboxPicker).not.toHaveBeenCalled();
  });

  test("non-TTY defaults to global", async () => {
    const scope = await promptInstallScope({
      scopeFlag: "both",
      provider,
      isTTY: false,
      yes: false,
      log: () => {},
    });
    expect(scope).toBe("global");
    expect(mocks.checkboxPicker).not.toHaveBeenCalled();
  });

  test("--yes defaults to global", async () => {
    const scope = await promptInstallScope({
      scopeFlag: "both",
      provider,
      isTTY: true,
      yes: true,
      log: () => {},
    });
    expect(scope).toBe("global");
    expect(mocks.checkboxPicker).not.toHaveBeenCalled();
  });

  test("TTY picker global", async () => {
    mocks.checkboxPicker.mockResolvedValueOnce([0]);
    const scope = await promptInstallScope({
      scopeFlag: "both",
      provider,
      isTTY: true,
      yes: false,
      log: () => {},
    });
    expect(scope).toBe("global");
    expect(mocks.checkboxPicker).toHaveBeenCalledOnce();
  });

  test("TTY picker project", async () => {
    mocks.checkboxPicker.mockResolvedValueOnce([1]);
    const scope = await promptInstallScope({
      scopeFlag: "both",
      provider,
      isTTY: true,
      yes: false,
      log: () => {},
    });
    expect(scope).toBe("project");
    expect(mocks.checkboxPicker).toHaveBeenCalledOnce();
  });

  test("dismissed scope picker throws", async () => {
    mocks.checkboxPicker.mockResolvedValueOnce([]);
    await expect(
      promptInstallScope({
        scopeFlag: null,
        provider,
        isTTY: true,
        yes: false,
        log: () => {},
      }),
    ).rejects.toThrow("No scope selected");
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawnSync: spawnSyncMock,
}));

const originalInjectedCommit = process.env.__ASM_COMMIT__;

describe("version utility", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnSyncMock.mockReset();
    delete process.env.__ASM_COMMIT__;
  });

  afterEach(() => {
    if (originalInjectedCommit === undefined) {
      delete process.env.__ASM_COMMIT__;
    } else {
      process.env.__ASM_COMMIT__ = originalInjectedCommit;
    }
  });

  test("does not resolve git commit when imported", async () => {
    await import("./version");

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  test("uses the injected commit without spawning git", async () => {
    process.env.__ASM_COMMIT__ = "bundled123";
    const version = await import("./version");

    expect(version.getCommitHash()).toBe("bundled123");
    expect(version.getVersionString()).toBe(`v${version.VERSION} (bundled123)`);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  test("resolves git lazily and memoizes the commit", async () => {
    spawnSyncMock.mockReturnValue({ stdout: "dev123\n", stderr: "" });
    const version = await import("./version");

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(version.getCommitHash()).toBe("dev123");
    expect(version.getVersionString()).toBe(`v${version.VERSION} (dev123)`);
    expect(version.getCommitHash()).toBe("dev123");
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  test("uses unknown when git resolution fails", async () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error("git unavailable");
    });
    const version = await import("./version");

    expect(version.getVersionString()).toBe(`v${version.VERSION} (unknown)`);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });
});

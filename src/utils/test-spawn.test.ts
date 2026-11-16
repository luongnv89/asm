import { describe, expect, it } from "vitest";
import { spawnCollect, spawnCollectTimed } from "./test-spawn";

describe("spawnCollectTimed", () => {
  it("kills a child that outlives its deadline and reports the elapsed time", async () => {
    const res = await spawnCollectTimed(
      [process.execPath, "-e", "setTimeout(() => {}, 30_000)"],
      { timeoutMs: 300 },
    );
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBe(-1);
    expect(res.elapsedMs).toBeGreaterThanOrEqual(300);
    expect(res.elapsedMs).toBeLessThan(10_000);
  });

  it("does not flag a child that exits before its deadline", async () => {
    const res = await spawnCollectTimed(
      [process.execPath, "-e", "process.stdout.write('ok'); process.exit(3)"],
      { timeoutMs: 10_000 },
    );
    expect(res.timedOut).toBe(false);
    expect(res.exitCode).toBe(3);
    expect(res.stdout).toBe("ok");
  });
});

describe("spawnCollect env sandbox", () => {
  it("keeps inherited ASM_CONFIG_DIR when HOME is not redirected", async () => {
    const res = await spawnCollect(
      [
        process.execPath,
        "-e",
        "process.stdout.write(process.env.ASM_CONFIG_DIR ?? '')",
      ],
      { env: { ...process.env } },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(process.env.ASM_CONFIG_DIR);
  });

  it("drops inherited ASM_CONFIG_DIR when HOME is redirected", async () => {
    const res = await spawnCollect(
      [
        process.execPath,
        "-e",
        "process.stdout.write(process.env.ASM_CONFIG_DIR ?? '')",
      ],
      { env: { ...process.env, HOME: "/tmp/asm-other-home" } },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("preserves an explicit ASM_CONFIG_DIR even when HOME is redirected", async () => {
    const res = await spawnCollect(
      [
        process.execPath,
        "-e",
        "process.stdout.write(process.env.ASM_CONFIG_DIR ?? '')",
      ],
      {
        env: {
          ...process.env,
          HOME: "/tmp/asm-other-home",
          ASM_CONFIG_DIR: "/tmp/asm-explicit-config",
        },
      },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("/tmp/asm-explicit-config");
  });
});

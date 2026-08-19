import { describe, expect, it } from "vitest";
import { spawnCollect } from "./test-spawn";

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

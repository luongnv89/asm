import { describe, expect, it } from "bun:test";
import { runProvider } from "./runner";
import type { EvalProvider, EvalResult, SkillContext } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const CTX: SkillContext = {
  skillPath: "/tmp/sample-skill",
  skillMdPath: "/tmp/sample-skill/SKILL.md",
};

function makeProvider(
  run: EvalProvider["run"],
  overrides: Partial<EvalProvider> = {},
): EvalProvider {
  return {
    id: "quality",
    version: "1.0.0",
    schemaVersion: 1,
    description: "test provider",
    async applicable() {
      return { ok: true };
    },
    run,
    ...overrides,
  };
}

function okResult(): EvalResult {
  return {
    providerId: "quality",
    providerVersion: "1.0.0",
    schemaVersion: 1,
    score: 85,
    passed: true,
    categories: [],
    findings: [],
    // Runner stamps these; value here is intentionally wrong so we can
    // assert the runner overwrites them.
    startedAt: "1970-01-01T00:00:00.000Z",
    durationMs: -1,
  };
}

// ─── Timing capture ─────────────────────────────────────────────────────────

describe("runner timing capture", () => {
  it("records startedAt as an ISO-8601 timestamp", async () => {
    const result = await runProvider(
      makeProvider(async () => okResult()),
      CTX,
    );
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Sanity: startedAt is close to "now" (within 5 seconds).
    const diff = Math.abs(Date.now() - new Date(result.startedAt).getTime());
    expect(diff).toBeLessThan(5_000);
  });

  it("records durationMs as a non-negative integer", async () => {
    const result = await runProvider(
      makeProvider(async () => {
        // Tiny artificial work so durationMs ticks up reliably.
        await new Promise((r) => setTimeout(r, 5));
        return okResult();
      }),
      CTX,
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(5);
  });

  it("overwrites the provider's claimed startedAt/durationMs fields", async () => {
    const result = await runProvider(
      makeProvider(async () => okResult()),
      CTX,
    );
    expect(result.startedAt).not.toBe("1970-01-01T00:00:00.000Z");
    expect(result.durationMs).not.toBe(-1);
  });

  it("stamps provider identity onto the returned result", async () => {
    // Provider returns an EvalResult claiming to be someone else.
    const spoofed = {
      ...okResult(),
      providerId: "wrong-id",
      providerVersion: "999.999.999",
      schemaVersion: 42,
    };
    const result = await runProvider(
      makeProvider(async () => spoofed, {
        id: "quality",
        version: "1.0.0",
        schemaVersion: 1,
      }),
      CTX,
    );
    expect(result.providerId).toBe("quality");
    expect(result.providerVersion).toBe("1.0.0");
    // schemaVersion may be left as the provider's declared value if set.
    // The runner only overrides when it is absent.
    expect(typeof result.schemaVersion).toBe("number");
  });

  it("captures timing even when the provider throws", async () => {
    const before = Date.now();
    const result = await runProvider(
      makeProvider(async () => {
        await new Promise((r) => setTimeout(r, 3));
        throw new Error("boom");
      }),
      CTX,
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(3);
    const started = new Date(result.startedAt).getTime();
    expect(started).toBeGreaterThanOrEqual(before - 100);
  });
});

// ─── Error wrapping ─────────────────────────────────────────────────────────

describe("runner error wrapping", () => {
  it("wraps thrown Error into an EvalResult with passed=false and score=0", async () => {
    const result = await runProvider(
      makeProvider(async () => {
        throw new Error("provider exploded");
      }),
      CTX,
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe("error");
    expect(result.findings[0]!.message).toBe("provider exploded");
    expect(result.findings[0]!.code).toBe("provider-threw");
  });

  it("preserves provider identity on the error result", async () => {
    const result = await runProvider(
      makeProvider(
        async () => {
          throw new Error("boom");
        },
        { id: "custom", version: "0.1.0", schemaVersion: 2 },
      ),
      CTX,
    );
    expect(result.providerId).toBe("custom");
    expect(result.providerVersion).toBe("0.1.0");
    expect(result.schemaVersion).toBe(2);
  });

  it("wraps non-Error throws with String coercion", async () => {
    const result = await runProvider(
      makeProvider(async () => {
        // eslint-disable-next-line no-throw-literal
        throw "string error";
      }),
      CTX,
    );
    expect(result.findings[0]!.message).toBe("string error");
  });

  it("wraps object throws via JSON.stringify", async () => {
    const result = await runProvider(
      makeProvider(async () => {
        throw { code: "X1", detail: "oops" };
      }),
      CTX,
    );
    expect(result.findings[0]!.message).toContain('"code":"X1"');
  });

  it("never re-throws — callers do not need try/catch", async () => {
    let caught = false;
    try {
      await runProvider(
        makeProvider(async () => {
          throw new Error("boom");
        }),
        CTX,
      );
    } catch {
      caught = true;
    }
    expect(caught).toBe(false);
  });

  it("produces an empty categories array and no raw on error", async () => {
    const result = await runProvider(
      makeProvider(async () => {
        throw new Error("boom");
      }),
      CTX,
    );
    expect(result.categories).toEqual([]);
    expect(result.raw).toBeUndefined();
  });
});

// ─── Timeout handling ───────────────────────────────────────────────────────

describe("runner timeout", () => {
  it("returns a timeout-shaped result when timeoutMs elapses", async () => {
    const result = await runProvider(
      makeProvider(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return okResult();
      }),
      CTX,
      { timeoutMs: 20 },
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.findings[0]!.code).toBe("timeout");
    expect(result.findings[0]!.message).toMatch(/timed out/);
  });

  it("does not time out when the provider finishes first", async () => {
    const result = await runProvider(
      makeProvider(async () => okResult()),
      CTX,
      { timeoutMs: 1_000 },
    );
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});

// ─── Happy path preservation ────────────────────────────────────────────────

describe("runner passthrough", () => {
  it("preserves provider score, passed, categories, findings, raw", async () => {
    const raw = { provider: "example", version: "0.1.3" };
    const result = await runProvider(
      makeProvider(async () => ({
        ...okResult(),
        score: 72,
        passed: true,
        categories: [{ id: "overall", name: "Overall", score: 7, max: 10 }],
        findings: [{ severity: "info", message: "ok" }],
        raw,
      })),
      CTX,
    );
    expect(result.score).toBe(72);
    expect(result.passed).toBe(true);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]!.id).toBe("overall");
    expect(result.findings[0]!.message).toBe("ok");
    expect(result.raw).toBe(raw);
  });
});

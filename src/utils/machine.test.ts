import { describe, expect, test } from "vitest";
import { formatMachineOutput, formatMachineError, ErrorCodes } from "./machine";
import type { MachineOutput } from "./machine";

describe("formatMachineOutput", () => {
  test("produces valid v1 envelope with ok status", () => {
    const startTime = performance.now() - 100; // simulate 100ms ago
    const output = formatMachineOutput("search", [{ name: "test" }], startTime);
    const parsed: MachineOutput = JSON.parse(output);

    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("search");
    expect(parsed.status).toBe("ok");
    expect(parsed.data).toEqual([{ name: "test" }]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(parsed.meta.asm_version).toBeDefined();
    expect(typeof parsed.meta.duration_ms).toBe("number");
    expect(parsed.meta.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("data can be an object", () => {
    const output = formatMachineOutput(
      "install",
      { name: "foo", path: "/tmp" },
      performance.now(),
    );
    const parsed = JSON.parse(output);

    expect(parsed.status).toBe("ok");
    expect(parsed.data.name).toBe("foo");
    expect(parsed.data.path).toBe("/tmp");
  });

  test("data can be an array", () => {
    const output = formatMachineOutput(
      "list",
      [{ name: "a" }, { name: "b" }],
      performance.now(),
    );
    const parsed = JSON.parse(output);

    expect(parsed.data).toHaveLength(2);
  });

  test("always includes meta block", () => {
    const output = formatMachineOutput("doctor", {}, performance.now());
    const parsed = JSON.parse(output);

    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.timestamp).toBeDefined();
    expect(parsed.meta.asm_version).toBeDefined();
    expect(typeof parsed.meta.duration_ms).toBe("number");
  });
});

describe("formatMachineError", () => {
  test("produces valid v1 envelope with error status", () => {
    const startTime = performance.now() - 50;
    const output = formatMachineError(
      "install",
      ErrorCodes.SKILL_NOT_FOUND,
      "No skill named 'foobar' found",
      startTime,
    );
    const parsed: MachineOutput = JSON.parse(output);

    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("install");
    expect(parsed.status).toBe("error");
    expect(parsed.data).toBeUndefined();
    expect(parsed.error).toBeDefined();
    expect(parsed.error!.code).toBe("SKILL_NOT_FOUND");
    expect(parsed.error!.message).toBe("No skill named 'foobar' found");
    expect(parsed.meta).toBeDefined();
  });

  test("includes details when provided", () => {
    const output = formatMachineError(
      "install",
      ErrorCodes.INSTALL_FAILED,
      "Conflict detected",
      performance.now(),
      { duplicates: ["foo", "bar"] },
    );
    const parsed = JSON.parse(output);

    expect(parsed.error.details).toEqual({ duplicates: ["foo", "bar"] });
  });

  test("omits details when not provided", () => {
    const output = formatMachineError(
      "publish",
      ErrorCodes.PUBLISH_FAILED,
      "Failed",
      performance.now(),
    );
    const parsed = JSON.parse(output);

    expect(parsed.error.details).toBeUndefined();
  });
});

describe("ErrorCodes", () => {
  test("contains expected error codes", () => {
    expect(ErrorCodes.SKILL_NOT_FOUND).toBe("SKILL_NOT_FOUND");
    expect(ErrorCodes.AUDIT_FAILED).toBe("AUDIT_FAILED");
    expect(ErrorCodes.INSTALL_FAILED).toBe("INSTALL_FAILED");
    expect(ErrorCodes.PUBLISH_FAILED).toBe("PUBLISH_FAILED");
    expect(ErrorCodes.NETWORK_ERROR).toBe("NETWORK_ERROR");
    expect(ErrorCodes.UNKNOWN_ERROR).toBe("UNKNOWN_ERROR");
  });
});

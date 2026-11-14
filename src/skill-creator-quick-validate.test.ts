import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

// Runs skill-creator's quick_validate.py as a subprocess and checks the
// non-fatal "missing ## Self-Improve" warning, including its fence stripping.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(
  REPO_ROOT,
  "skills/skill-creator/scripts/quick_validate.py",
);
const WARNING = "has no '## Self-Improve' section";

// The validator imports PyYAML; CI's unit job installs neither python3 nor it.
const pythonAvailable =
  spawnSync("python3", ["-c", "import yaml"], { stdio: "ignore" }).status === 0;

const FRONTMATTER = [
  "---",
  "name: fixture-skill",
  "description: Fixture skill for quick_validate tests. Don't use for anything real.",
  "---",
  "",
].join("\n");

const FENCE3 = "```";
const FENCE4 = "````";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function validate(dir: string) {
  const result = spawnSync("python3", [SCRIPT, dir], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

function validateBody(bodyLines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "asm-quick-validate-"));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, "SKILL.md"),
    FRONTMATTER + bodyLines.join("\n") + "\n",
  );
  return validate(dir);
}

describe.skipIf(!pythonAvailable)(
  "quick_validate.py Self-Improve warning (skipped when python3 with PyYAML is not available)",
  () => {
    test("heading present: no warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        "## Self-Improve",
        "",
        "Propose improvements.",
      ]);
      expect(status).toBe(0);
      expect(stderr).not.toContain(WARNING);
    });

    test("heading missing: warning, still exit 0", () => {
      const { status, stderr } = validateBody(["# Fixture", "", "No section."]);
      expect(status).toBe(0);
      expect(stderr).toContain(WARNING);
    });

    test("heading only inside a backtick fence: warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        FENCE3 + "markdown",
        "## Self-Improve",
        FENCE3,
      ]);
      expect(status).toBe(0);
      expect(stderr).toContain(WARNING);
    });

    test("heading only inside a tilde fence: warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        "~~~",
        "## Self-Improve",
        "~~~",
      ]);
      expect(status).toBe(0);
      expect(stderr).toContain(WARNING);
    });

    test("heading after a fenced block: no warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        FENCE3 + "bash",
        "echo hi",
        FENCE3,
        "",
        "## Self-Improve",
      ]);
      expect(status).toBe(0);
      expect(stderr).not.toContain(WARNING);
    });

    test("lowercase heading with a suffix: no warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        "## self-improve (opt-out)",
      ]);
      expect(status).toBe(0);
      expect(stderr).not.toContain(WARNING);
    });

    test("a fence closed by a longer run is closed: real heading after it, no warning", () => {
      // The later exact closer matters: without it, an exact-match closer
      // rule leaves the fence unstripped and the heading is found anyway.
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        FENCE3,
        "example",
        FENCE4,
        "",
        "## Self-Improve",
        "",
        FENCE3 + "bash",
        "echo later",
        FENCE3,
      ]);
      expect(status).toBe(0);
      expect(stderr).not.toContain(WARNING);
    });

    test("an indented fence inside a list item hides a quoted heading: warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        "- item",
        "  " + FENCE3 + "markdown",
        "## Self-Improve",
        "  " + FENCE3,
      ]);
      expect(status).toBe(0);
      expect(stderr).toContain(WARNING);
    });

    test("an unclosed fence runs to the end of the body: warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        FENCE3,
        "## Self-Improve",
      ]);
      expect(status).toBe(0);
      expect(stderr).toContain(WARNING);
    });

    test("a backtick run with a backtick in its info string is not a fence: no warning", () => {
      const { status, stderr } = validateBody([
        "# Fixture",
        "",
        FENCE3 + "not a fence" + FENCE3,
        "",
        "## Self-Improve",
      ]);
      expect(status).toBe(0);
      expect(stderr).not.toContain(WARNING);
    });

    test("the shipped skill-creator skill: exit 0, no warning", () => {
      const { status, stderr } = validate(
        join(REPO_ROOT, "skills/skill-creator"),
      );
      expect(status).toBe(0);
      expect(stderr).not.toContain(WARNING);
    });
  },
);

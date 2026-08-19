/**
 * Per-file vitest sandbox so in-process tests never touch the developer's
 * real home or ~/.config/agent-skill-manager.
 *
 * HOME/USERPROFILE cover os.homedir() (scanner, uninstaller, ~ expansion).
 * ASM_CONFIG_DIR is the explicit product override read by getConfigDir().
 */
import { afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hostHome = process.env.HOME ?? process.env.USERPROFILE ?? "";
const sandboxHome = mkdtempSync(join(tmpdir(), "asm-vitest-"));
const sandboxConfigDir = join(sandboxHome, ".config", "agent-skill-manager");

process.env.ASM_TEST_HOST_HOME = hostHome;
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;
process.env.ASM_CONFIG_DIR = sandboxConfigDir;
mkdirSync(sandboxConfigDir, { recursive: true });

afterAll(() => {
  rmSync(sandboxHome, { recursive: true, force: true });
});

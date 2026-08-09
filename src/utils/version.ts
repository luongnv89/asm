import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _version: string = (process.env.__ASM_VERSION__ as string) || "0.0.0";
try {
  const raw = readFileSync(resolve(__dirname, "../../package.json"), "utf-8");
  const pkg = JSON.parse(raw);
  _version = pkg.version;
} catch {
  // Bundled mode — use build-time injected version
}

let _commit: string | undefined;

export const VERSION = _version;

export function getCommitHash(): string {
  if (_commit !== undefined) {
    return _commit;
  }

  const injectedCommit = process.env.__ASM_COMMIT__;
  if (injectedCommit !== undefined) {
    _commit = injectedCommit;
    return _commit;
  }

  _commit = "unknown";
  try {
    _commit =
      execSync("git rev-parse --short HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim() || _commit;
  } catch {
    // Not in a git repo or git not available
  }

  return _commit;
}

export function getVersionString(): string {
  return `v${VERSION} (${getCommitHash()})`;
}

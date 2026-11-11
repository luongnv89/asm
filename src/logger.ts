import { stripControlBytes } from "./utils/control-chars";

let _verbose = false;
let _startTime = 0;

export function setVerbose(enabled: boolean): void {
  _verbose = enabled;
  if (enabled) {
    _startTime = performance.now();
  }
}

export function isVerbose(): boolean {
  return _verbose;
}

export function debug(msg: string): void {
  if (!_verbose) return;
  const elapsed = Math.round(performance.now() - _startTime);
  const noColor = globalThis.__CLI_NO_COLOR;
  const prefix = noColor
    ? `[verbose] +${elapsed}ms`
    : `\x1b[2m[verbose] +${elapsed}ms\x1b[0m`;
  // Messages carry author folder and file names (#830): one debug() call is
  // one log line, so LF and CR show as visible `\n` / `\r` markers and every
  // other control byte as `?`. A caller with several lines calls debug() once
  // per line.
  const clean = stripControlBytes(
    msg.replace(/\n/g, "\\n").replace(/\r/g, "\\r"),
  );
  console.error(`${prefix} ${clean}`);
}

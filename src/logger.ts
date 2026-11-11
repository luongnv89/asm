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
  // Messages carry author folder and file names: strip their control bytes
  // (#830), keeping the line breaks and the prefix's own styling.
  const clean = msg.split("\n").map(stripControlBytes).join("\n");
  console.error(`${prefix} ${clean}`);
}

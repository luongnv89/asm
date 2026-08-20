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
  console.error(`${prefix} ${msg}`);
}

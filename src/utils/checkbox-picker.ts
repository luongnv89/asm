import { ansi } from "../formatter";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckboxItem {
  label: string;
  hint?: string;
  checked: boolean;
}

export interface CheckboxPickerOptions {
  items: CheckboxItem[];
  pageSize?: number;
}

// ─── Pure State Machine ──────────────────────────────────────────────────────

export class CheckboxState {
  selected: boolean[];
  cursor: number; // index into visibleRows (0 = "Select All", 1..N = filtered items)
  scrollOffset: number;
  readonly pageSize: number;
  readonly itemCount: number;

  // Search/filter
  filter: string;
  searchActive: boolean;
  /** Maps filtered row index (1-based) → original item index (0-based) */
  filteredMap: number[];

  constructor(items: CheckboxItem[], pageSize: number) {
    this.selected = items.map((i) => i.checked);
    this.cursor = 1; // start on first real item, not "Select All"
    this.scrollOffset = 0;
    this.pageSize = pageSize;
    this.itemCount = items.length;
    this.filter = "";
    this.searchActive = false;
    this.filteredMap = items.map((_, i) => i); // identity mapping initially
  }

  get totalRows(): number {
    return this.filteredMap.length + 1; // filtered items + "Select All"
  }

  applyFilter(items: CheckboxItem[]): void {
    if (this.filter === "") {
      this.filteredMap = items.map((_, i) => i);
    } else {
      const query = this.filter.toLowerCase();
      this.filteredMap = [];
      for (let i = 0; i < items.length; i++) {
        const text =
          items[i].label.toLowerCase() +
          " " +
          (items[i].hint?.toLowerCase() ?? "");
        if (text.includes(query)) {
          this.filteredMap.push(i);
        }
      }
    }
    // Reset cursor/scroll to stay in bounds
    if (this.cursor >= this.totalRows) {
      this.cursor = Math.max(0, this.totalRows - 1);
    }
    if (this.scrollOffset > 0 && this.scrollOffset >= this.totalRows) {
      this.scrollOffset = Math.max(0, this.totalRows - this.pageSize);
    }
  }

  /** Map current cursor position to original item index. Returns -1 if on "Select All" row. */
  cursorToOriginalIndex(): number {
    if (this.cursor === 0) return -1;
    return this.filteredMap[this.cursor - 1] ?? -1;
  }

  toggleCurrent(): void {
    if (this.cursor === 0) {
      this.toggleAll();
    } else {
      const origIdx = this.cursorToOriginalIndex();
      if (origIdx >= 0) {
        this.selected[origIdx] = !this.selected[origIdx];
      }
    }
  }

  toggleAll(): void {
    // When filtered, toggle only visible (filtered) items
    const visibleIndices = this.filteredMap;
    const allVisible = visibleIndices.every((i) => this.selected[i]);
    const newValue = !allVisible;
    for (const i of visibleIndices) {
      this.selected[i] = newValue;
    }
  }

  moveUp(): void {
    if (this.cursor > 0) {
      this.cursor--;
    } else {
      this.cursor = this.totalRows - 1;
    }
    this.adjustScroll();
  }

  moveDown(): void {
    if (this.cursor < this.totalRows - 1) {
      this.cursor++;
    } else {
      this.cursor = 0;
    }
    this.adjustScroll();
  }

  getSelectedIndices(): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this.selected.length; i++) {
      if (this.selected[i]) indices.push(i);
    }
    return indices;
  }

  getVisibleRange(): { start: number; end: number } {
    const start = this.scrollOffset;
    const end = Math.min(this.scrollOffset + this.pageSize, this.totalRows);
    return { start, end };
  }

  private adjustScroll(): void {
    if (this.cursor < this.scrollOffset) {
      this.scrollOffset = this.cursor;
    } else if (this.cursor >= this.scrollOffset + this.pageSize) {
      this.scrollOffset = this.cursor - this.pageSize + 1;
    }
  }
}

// ─── Pure Renderer ───────────────────────────────────────────────────────────

export function renderCheckboxLines(
  state: CheckboxState,
  items: CheckboxItem[],
  width: number,
): string[] {
  const lines: string[] = [];

  // Search bar (always shown when search is active or filter is non-empty)
  if (state.searchActive || state.filter !== "") {
    const searchPrompt = ansi.cyan("/");
    const filterText = state.filter;
    const cursor = state.searchActive ? ansi.cyan("█") : "";
    lines.push(`  ${searchPrompt}${filterText}${cursor}`);
    if (state.filteredMap.length === 0) {
      lines.push(ansi.dim("  No matches found"));
    }
    lines.push(""); // separator
  }

  const { start, end } = state.getVisibleRange();

  // Scroll indicator: above
  if (start > 0) {
    lines.push(ansi.dim(`  ... ${start} more above`));
  }

  for (let row = start; row < end; row++) {
    const isCursor = row === state.cursor;
    const pointer = isCursor ? ansi.cyan(">") : " ";

    if (row === 0) {
      // "Select All" virtual row — reflects state of filtered items
      const visibleIndices = state.filteredMap;
      const allChecked =
        visibleIndices.length > 0 &&
        visibleIndices.every((i) => state.selected[i]);
      const marker = allChecked ? ansi.green("[*]") : "[ ]";
      const label =
        state.filter !== ""
          ? `Select All Matching (${state.filteredMap.length})`
          : "Select All / Deselect All";
      lines.push(`${pointer} ${marker} ${ansi.bold(label)}`);
    } else {
      const origIdx = state.filteredMap[row - 1];
      const item = items[origIdx];
      const checked = state.selected[origIdx];
      const marker = checked ? ansi.green("[*]") : "[ ]";

      // Build the line: "> [*] label  hint"
      // Prefix: "> [*] " = 7 chars visible
      const prefix = `${pointer} ${marker} `;
      const prefixLen = 7; // "> [*] " or "  [*] "
      const labelStr = ansi.bold(item.label);
      const labelLen = item.label.length;

      if (item.hint) {
        const availableForHint = width - prefixLen - labelLen - 2; // 2 for "  " separator
        if (availableForHint > 10) {
          const truncatedHint = truncateText(item.hint, availableForHint);
          lines.push(`${prefix}${labelStr}  ${ansi.dim(truncatedHint)}`);
        } else {
          // No room for hint
          const truncatedLabel = truncateText(item.label, width - prefixLen);
          lines.push(`${prefix}${ansi.bold(truncatedLabel)}`);
        }
      } else {
        const truncatedLabel = truncateText(item.label, width - prefixLen);
        lines.push(`${prefix}${ansi.bold(truncatedLabel)}`);
      }
    }
  }

  // Scroll indicator: below
  const remainingBelow = state.totalRows - end;
  if (remainingBelow > 0) {
    lines.push(ansi.dim(`  ... ${remainingBelow} more below`));
  }

  // Selection count + keybindings footer
  const selectedCount = state.getSelectedIndices().length;
  const filterNote =
    state.filter !== ""
      ? `  matching: ${state.filteredMap.length}/${state.itemCount}`
      : "";
  lines.push("");
  if (state.searchActive) {
    lines.push(
      ansi.dim(
        `  ${selectedCount} of ${state.itemCount} selected${filterNote}  |  ` +
          `Type to filter  Esc Clear  Enter Done searching`,
      ),
    );
  } else {
    lines.push(
      ansi.dim(
        `  ${selectedCount} of ${state.itemCount} selected${filterNote}  |  ` +
          `↑/↓ Navigate  Space Toggle  a All  / Search  Enter Confirm  Esc Cancel`,
      ),
    );
  }

  return lines;
}

function truncateText(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return text.slice(0, maxLen);
  return text.slice(0, maxLen - 3) + "...";
}

// ─── I/O Orchestrator ────────────────────────────────────────────────────────

export async function checkboxPicker(
  options: CheckboxPickerOptions,
): Promise<number[]> {
  const { items } = options;
  const pageSize = options.pageSize ?? Math.min(items.length + 1, 15);
  const state = new CheckboxState(items, pageSize);

  const output = process.stderr;
  const input = process.stdin;
  const width = (output as any).columns || 80;

  // Enable raw mode
  if (typeof input.setRawMode === "function") {
    input.setRawMode(true);
  }
  input.resume();
  input.setEncoding("utf-8");

  // Hide cursor
  output.write("\x1b[?25l");

  let lastLineCount = 0;

  function render() {
    const lines = renderCheckboxLines(state, items, width);

    // Move cursor up by exactly how many lines we previously wrote
    if (lastLineCount > 0) {
      output.write(`\x1b[${lastLineCount}F`);
    }

    // Write all lines in a single buffer to avoid flicker.
    // Write max(current, previous) lines to clear stale content.
    const writeCount = Math.max(lines.length, lastLineCount);
    let buf = "";
    for (let i = 0; i < writeCount; i++) {
      buf += `\x1b[2K${i < lines.length ? lines[i] : ""}\n`;
    }
    output.write(buf);

    lastLineCount = writeCount;
  }

  // Initial render
  render();

  return new Promise<number[]>((resolve) => {
    let escBuf = "";
    let escTimer: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      input.removeListener("data", onData);
      if (typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      input.pause();
      // Show cursor
      output.write("\x1b[?25h");
      if (escTimer) clearTimeout(escTimer);
    }

    function finish(result: number[]) {
      cleanup();
      resolve(result);
    }

    function handleKey(key: string) {
      // ── Search mode ──────────────────────────────────────────────────
      if (state.searchActive) {
        if (key === "\x1b") {
          // Escape: clear filter and exit search mode
          state.searchActive = false;
          state.filter = "";
          state.applyFilter(items);
          render();
          return;
        }
        if (key === "\r" || key === "\n") {
          // Enter: exit search mode, keep filter applied
          state.searchActive = false;
          render();
          return;
        }
        if (key === "\x7f" || key === "\b") {
          // Backspace
          if (state.filter.length > 0) {
            state.filter = state.filter.slice(0, -1);
            state.applyFilter(items);
          } else {
            // Empty filter + backspace: exit search mode
            state.searchActive = false;
          }
          render();
          return;
        }
        if (key === "\x03") {
          // Ctrl-C
          cleanup();
          process.kill(process.pid, "SIGINT");
          return;
        }
        // Arrow keys still work during search for navigation (not j/k)
        if (key === "\x1b[A") {
          state.moveUp();
          render();
          return;
        }
        if (key === "\x1b[B") {
          state.moveDown();
          render();
          return;
        }
        if (key === " ") {
          // Space toggles even in search mode
          state.toggleCurrent();
          render();
          return;
        }
        // Printable character: append to filter
        if (key.length === 1 && key >= " " && key <= "~") {
          state.filter += key;
          state.applyFilter(items);
          render();
          return;
        }
        return;
      }

      // ── Normal mode ──────────────────────────────────────────────────
      switch (key) {
        case "\x1b[A": // Up arrow
        case "k":
          state.moveUp();
          render();
          break;
        case "\x1b[B": // Down arrow
        case "j":
          state.moveDown();
          render();
          break;
        case " ": // Space — toggle
          state.toggleCurrent();
          render();
          break;
        case "a": // Toggle all (visible)
          state.toggleAll();
          render();
          break;
        case "/": // Activate search
          state.searchActive = true;
          render();
          break;
        case "\r": // Enter — confirm
        case "\n":
          finish(state.getSelectedIndices());
          break;
        case "\x1b": // Escape
          if (state.filter !== "") {
            // Clear filter first
            state.filter = "";
            state.applyFilter(items);
            render();
          } else {
            finish([]);
          }
          break;
        case "\x7f": // Backspace — remove last filter char if filter active
        case "\b":
          if (state.filter.length > 0) {
            state.filter = state.filter.slice(0, -1);
            state.applyFilter(items);
            render();
          }
          break;
        case "\x03": // Ctrl-C
          cleanup();
          process.kill(process.pid, "SIGINT");
          break;
      }
    }

    function onData(data: string) {
      // Handle escape sequences
      if (escBuf.length > 0) {
        escBuf += data;
        if (escTimer) clearTimeout(escTimer);

        // Check if we have a complete escape sequence
        if (escBuf.length >= 3 && escBuf[1] === "[") {
          const seq = escBuf.slice(0, 3);
          const remainder = escBuf.slice(3);
          escBuf = "";
          handleKey(seq);
          // Process any remaining data
          if (remainder) onData(remainder);
          return;
        }

        // If we got data that doesn't form a known sequence, treat as standalone escape
        const buf = escBuf;
        escBuf = "";
        handleKey("\x1b");
        // Process remaining chars after the escape
        for (let i = 1; i < buf.length; i++) {
          handleKey(buf[i]);
        }
        return;
      }

      // Process each character/sequence
      for (let i = 0; i < data.length; i++) {
        const ch = data[i];

        if (ch === "\x1b") {
          // Start of potential escape sequence
          const remaining = data.slice(i);
          if (remaining.length >= 3 && remaining[1] === "[") {
            handleKey(remaining.slice(0, 3));
            i += 2; // skip the next 2 chars
          } else if (remaining.length >= 2) {
            // Partial sequence in this chunk — buffer it
            escBuf = remaining;
            escTimer = setTimeout(() => {
              const buf = escBuf;
              escBuf = "";
              handleKey("\x1b");
              for (let j = 1; j < buf.length; j++) {
                handleKey(buf[j]);
              }
            }, 50);
            return; // stop processing this data chunk
          } else {
            // Single escape byte — buffer with timeout
            escBuf = "\x1b";
            escTimer = setTimeout(() => {
              escBuf = "";
              handleKey("\x1b");
            }, 50);
            return;
          }
        } else {
          handleKey(ch);
        }
      }
    }

    input.on("data", onData);
  });
}

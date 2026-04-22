import { describe, test, expect } from "vitest";
import {
  CheckboxState,
  renderCheckboxLines,
  type CheckboxItem,
} from "./checkbox-picker";

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeItems(n: number, checked = false): CheckboxItem[] {
  return Array.from({ length: n }, (_, i) => ({
    label: `skill-${i + 1}`,
    hint: `v${i + 1}.0.0  Description for skill ${i + 1}`,
    checked,
  }));
}

// ─── CheckboxState ───────────────────────────────────────────────────────────

describe("CheckboxState", () => {
  test("initializes with correct defaults", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    expect(state.cursor).toBe(1); // starts on first real item
    expect(state.scrollOffset).toBe(0);
    expect(state.selected).toEqual([false, false, false]);
    expect(state.totalRows).toBe(4); // 3 items + 1 "Select All"
    expect(state.filter).toBe("");
    expect(state.searchActive).toBe(false);
  });

  test("initializes with pre-checked items", () => {
    const items = makeItems(3, true);
    const state = new CheckboxState(items, 10);
    expect(state.selected).toEqual([true, true, true]);
  });

  test("toggleCurrent toggles item at cursor", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    // cursor starts at 1 (first real item, index 0)
    state.toggleCurrent();
    expect(state.selected).toEqual([true, false, false]);

    state.toggleCurrent();
    expect(state.selected).toEqual([false, false, false]);
  });

  test("toggleCurrent on row 0 toggles all", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.cursor = 0;
    state.toggleCurrent();
    expect(state.selected).toEqual([true, true, true]);

    state.toggleCurrent();
    expect(state.selected).toEqual([false, false, false]);
  });

  test("toggleAll checks all when some are unchecked", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.selected[0] = true;
    state.toggleAll();
    expect(state.selected).toEqual([true, true, true]);
  });

  test("toggleAll unchecks all when all are checked", () => {
    const items = makeItems(3, true);
    const state = new CheckboxState(items, 10);
    state.toggleAll();
    expect(state.selected).toEqual([false, false, false]);
  });

  test("moveDown advances cursor", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    expect(state.cursor).toBe(1);
    state.moveDown();
    expect(state.cursor).toBe(2);
    state.moveDown();
    expect(state.cursor).toBe(3);
  });

  test("moveDown wraps to top", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.cursor = 3; // last row
    state.moveDown();
    expect(state.cursor).toBe(0); // wraps to "Select All"
  });

  test("moveUp goes to previous item", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.cursor = 2;
    state.moveUp();
    expect(state.cursor).toBe(1);
  });

  test("moveUp wraps to bottom", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.cursor = 0;
    state.moveUp();
    expect(state.cursor).toBe(3); // wraps to last item
  });

  test("getSelectedIndices returns 0-based item indices", () => {
    const items = makeItems(5);
    const state = new CheckboxState(items, 10);
    state.selected[0] = true;
    state.selected[2] = true;
    state.selected[4] = true;
    expect(state.getSelectedIndices()).toEqual([0, 2, 4]);
  });

  test("getSelectedIndices returns empty when nothing selected", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    expect(state.getSelectedIndices()).toEqual([]);
  });

  test("getVisibleRange returns correct range", () => {
    const items = makeItems(20);
    const state = new CheckboxState(items, 10);
    expect(state.getVisibleRange()).toEqual({ start: 0, end: 10 });
  });

  test("scroll adjusts when cursor moves below visible range", () => {
    const items = makeItems(20);
    const state = new CheckboxState(items, 5);
    // Move cursor to row 5 (beyond pageSize of 5)
    for (let i = 0; i < 5; i++) state.moveDown();
    expect(state.cursor).toBe(6);
    expect(state.scrollOffset).toBe(2); // adjusted so cursor is visible
  });

  test("scroll adjusts when cursor moves above visible range", () => {
    const items = makeItems(20);
    const state = new CheckboxState(items, 5);
    // Move down, then back up past scroll
    state.cursor = 10;
    state.scrollOffset = 8;
    state.moveUp();
    expect(state.cursor).toBe(9);
    expect(state.scrollOffset).toBe(8); // still visible
    // Move up a lot
    for (let i = 0; i < 5; i++) state.moveUp();
    expect(state.cursor).toBe(4);
    expect(state.scrollOffset).toBe(4); // adjusted
  });
});

// ─── Filter/Search ───────────────────────────────────────────────────────────

describe("CheckboxState filter", () => {
  test("applyFilter with empty string shows all items", () => {
    const items = makeItems(5);
    const state = new CheckboxState(items, 10);
    state.filter = "";
    state.applyFilter(items);
    expect(state.filteredMap).toEqual([0, 1, 2, 3, 4]);
    expect(state.totalRows).toBe(6); // 5 items + Select All
  });

  test("applyFilter narrows to matching items", () => {
    const items: CheckboxItem[] = [
      { label: "agent-config", hint: "v1.0  Config tool", checked: false },
      { label: "code-review", hint: "v2.0  Review code", checked: false },
      { label: "code-optimizer", hint: "v1.0  Optimize code", checked: false },
      { label: "blog-draft", hint: "v1.0  Draft blogs", checked: false },
    ];
    const state = new CheckboxState(items, 10);
    state.filter = "code";
    state.applyFilter(items);
    expect(state.filteredMap).toEqual([1, 2]); // code-review, code-optimizer
    expect(state.totalRows).toBe(3); // 2 items + Select All
  });

  test("applyFilter is case-insensitive", () => {
    const items: CheckboxItem[] = [
      { label: "Code-Review", hint: "v1.0", checked: false },
      { label: "blog-draft", hint: "v1.0", checked: false },
    ];
    const state = new CheckboxState(items, 10);
    state.filter = "CODE";
    state.applyFilter(items);
    expect(state.filteredMap).toEqual([0]);
  });

  test("applyFilter matches against hint too", () => {
    const items: CheckboxItem[] = [
      { label: "skill-a", hint: "v1.0  Database migration", checked: false },
      { label: "skill-b", hint: "v1.0  Frontend UI", checked: false },
    ];
    const state = new CheckboxState(items, 10);
    state.filter = "database";
    state.applyFilter(items);
    expect(state.filteredMap).toEqual([0]);
  });

  test("applyFilter with no matches produces empty filteredMap", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.filter = "zzzznotfound";
    state.applyFilter(items);
    expect(state.filteredMap).toEqual([]);
    expect(state.totalRows).toBe(1); // only "Select All" row
  });

  test("cursor clamps when filter reduces list", () => {
    const items = makeItems(10);
    const state = new CheckboxState(items, 15);
    state.cursor = 8;
    state.filter = "skill-1"; // matches skill-1, skill-10
    state.applyFilter(items);
    // totalRows = 3 (Select All + 2 matches), cursor should clamp
    expect(state.cursor).toBeLessThan(state.totalRows);
  });

  test("toggleAll with filter only toggles filtered items", () => {
    const items: CheckboxItem[] = [
      { label: "code-review", checked: false, hint: "" },
      { label: "blog-draft", checked: false, hint: "" },
      { label: "code-optimizer", checked: false, hint: "" },
    ];
    const state = new CheckboxState(items, 10);
    state.filter = "code";
    state.applyFilter(items);
    state.toggleAll();
    // Only code-review (0) and code-optimizer (2) should be toggled
    expect(state.selected).toEqual([true, false, true]);
  });

  test("toggleCurrent with filter maps to correct original index", () => {
    const items: CheckboxItem[] = [
      { label: "alpha", checked: false, hint: "" },
      { label: "beta", checked: false, hint: "" },
      { label: "bravo", checked: false, hint: "" },
    ];
    const state = new CheckboxState(items, 10);
    state.filter = "b";
    state.applyFilter(items);
    // filteredMap = [1, 2] (beta, bravo)
    state.cursor = 1; // first filtered item = beta (original index 1)
    state.toggleCurrent();
    expect(state.selected).toEqual([false, true, false]);

    state.cursor = 2; // second filtered item = bravo (original index 2)
    state.toggleCurrent();
    expect(state.selected).toEqual([false, true, true]);
  });

  test("getSelectedIndices returns all selected regardless of filter", () => {
    const items = makeItems(5);
    const state = new CheckboxState(items, 10);
    state.selected[0] = true;
    state.selected[3] = true;
    state.filter = "skill-1"; // only shows skill-1
    state.applyFilter(items);
    // getSelectedIndices should still return both
    expect(state.getSelectedIndices()).toEqual([0, 3]);
  });
});

// ─── renderCheckboxLines ─────────────────────────────────────────────────────

describe("renderCheckboxLines", () => {
  test("renders all rows when list fits in page", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    const lines = renderCheckboxLines(state, items, 80);

    // 4 rows (Select All + 3 items) + empty line + footer = 6 lines
    // No scroll indicators since list fits
    expect(lines.length).toBe(6);
  });

  test("shows cursor marker on current row", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.cursor = 2; // second item
    const lines = renderCheckboxLines(state, items, 80);

    // Strip ANSI codes for easier matching
    const stripped = lines.map(stripAnsi);
    // Row 0 = Select All (no cursor), Row 1 = item 1 (no cursor), Row 2 = item 2 (cursor)
    expect(stripped[0]).toMatch(/^\s/); // no cursor on Select All
    expect(stripped[1]).toMatch(/^\s/); // no cursor on item 1
    expect(stripped[2]).toMatch(/^>/); // cursor on item 2
  });

  test("shows checked markers correctly", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.selected[0] = true;
    state.selected[2] = true;
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped[1]).toContain("[*]"); // item 0 checked
    expect(stripped[2]).toContain("[ ]"); // item 1 unchecked
    expect(stripped[3]).toContain("[*]"); // item 2 checked
  });

  test("shows Select All as checked when all items are checked", () => {
    const items = makeItems(3, true);
    const state = new CheckboxState(items, 10);
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped[0]).toContain("[*]");
    expect(stripped[0]).toContain("Select All");
  });

  test("shows Select All as unchecked when not all items checked", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.selected[0] = true;
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped[0]).toContain("[ ]");
  });

  test("shows scroll indicators when list is scrolled", () => {
    const items = makeItems(20);
    const state = new CheckboxState(items, 5);
    state.cursor = 10;
    state.scrollOffset = 8;
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped[0]).toContain("8 more above");
    expect(stripped[stripped.length - 3]).toContain("more below");
  });

  test("does not show scroll indicators when list fits", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    const hasAbove = stripped.some((l) => l.includes("more above"));
    const hasBelow = stripped.some((l) => l.includes("more below"));
    expect(hasAbove).toBe(false);
    expect(hasBelow).toBe(false);
  });

  test("truncates long hints at narrow width", () => {
    const items: CheckboxItem[] = [
      {
        label: "skill",
        hint: "v1.0.0  This is a very long description that should be truncated",
        checked: false,
      },
    ];
    const state = new CheckboxState(items, 10);
    state.cursor = 1;
    const lines = renderCheckboxLines(state, items, 40);
    const stripped = lines.map(stripAnsi);

    // The hint line should be truncated
    const itemLine = stripped[1]; // item row
    expect(itemLine).toContain("...");
  });

  test("shows selection count in footer", () => {
    const items = makeItems(5);
    const state = new CheckboxState(items, 10);
    state.selected[0] = true;
    state.selected[3] = true;
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);
    const footer = stripped[stripped.length - 1];

    expect(footer).toContain("2 of 5 selected");
  });

  test("handles items with no hint", () => {
    const items: CheckboxItem[] = [{ label: "no-hint-skill", checked: false }];
    const state = new CheckboxState(items, 10);
    state.cursor = 1;
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped[1]).toContain("no-hint-skill");
  });

  test("renders search bar when searchActive", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.searchActive = true;
    state.filter = "skill";
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped[0]).toContain("/skill");
  });

  test("renders 'No matches found' when filter has no results", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.searchActive = true;
    state.filter = "zzzzz";
    state.applyFilter(items);
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped.some((l) => l.includes("No matches found"))).toBe(true);
  });

  test("shows matching count when filter is active", () => {
    const items: CheckboxItem[] = [
      { label: "code-review", checked: false, hint: "" },
      { label: "blog-draft", checked: false, hint: "" },
      { label: "code-optimizer", checked: false, hint: "" },
    ];
    const state = new CheckboxState(items, 10);
    state.filter = "code";
    state.applyFilter(items);
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);
    const footer = stripped[stripped.length - 1];

    expect(footer).toContain("matching: 2/3");
  });

  test("shows 'Select All Matching' when filter is active", () => {
    const items: CheckboxItem[] = [
      { label: "code-review", checked: false, hint: "" },
      { label: "blog-draft", checked: false, hint: "" },
      { label: "code-optimizer", checked: false, hint: "" },
    ];
    const state = new CheckboxState(items, 10);
    state.filter = "code";
    state.applyFilter(items);
    state.cursor = 0;
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);

    expect(stripped.some((l) => l.includes("Select All Matching (2)"))).toBe(
      true,
    );
  });

  test("shows search-mode keybindings when searchActive", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    state.searchActive = true;
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);
    const footer = stripped[stripped.length - 1];

    expect(footer).toContain("Type to filter");
    expect(footer).not.toContain("/ Search");
  });

  test("shows normal keybindings with / Search when not searching", () => {
    const items = makeItems(3);
    const state = new CheckboxState(items, 10);
    const lines = renderCheckboxLines(state, items, 80);
    const stripped = lines.map(stripAnsi);
    const footer = stripped[stripped.length - 1];

    expect(footer).toContain("/ Search");
  });
});

// ─── Helper: strip ANSI codes ────────────────────────────────────────────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

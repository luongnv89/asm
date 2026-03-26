import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dir, "..");
const README = join(ROOT, "README.md");
const WEBSITE = join(ROOT, "website", "index.html");
const ACK_JSON = join(ROOT, "website", "data", "acknowledgements.json");

// ─── acknowledgements.json (single source of truth) ────────────────────────

describe("acknowledgements: data file", () => {
  const data = JSON.parse(readFileSync(ACK_JSON, "utf-8"));

  test("acknowledgements.json has contributors array", () => {
    expect(Array.isArray(data.contributors)).toBe(true);
    expect(data.contributors.length).toBeGreaterThanOrEqual(1);
  });

  test("acknowledgements.json has dependencies array", () => {
    expect(Array.isArray(data.dependencies)).toBe(true);
    expect(data.dependencies.length).toBeGreaterThanOrEqual(1);
  });

  test("each contributor has login and prs", () => {
    for (const c of data.contributors) {
      expect(typeof c.login).toBe("string");
      expect(Array.isArray(c.prs)).toBe(true);
      expect(c.prs.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("each dependency has name, url, and desc", () => {
    for (const d of data.dependencies) {
      expect(typeof d.name).toBe("string");
      expect(typeof d.url).toBe("string");
      expect(typeof d.desc).toBe("string");
    }
  });
});

// ─── README.md acknowledgements section ─────────────────────────────────────

describe("acknowledgements: README.md", () => {
  const readme = readFileSync(README, "utf-8");
  const data = JSON.parse(readFileSync(ACK_JSON, "utf-8"));

  test("README contains Acknowledgements heading", () => {
    expect(readme).toContain("## Acknowledgements");
  });

  test("README contains all contributor handles", () => {
    for (const c of data.contributors) {
      expect(readme).toContain(`@${c.login}`);
    }
  });

  test("README contains all dependency names", () => {
    for (const d of data.dependencies) {
      expect(readme).toContain(d.name);
    }
  });

  test("README PR count matches JSON data for each contributor", () => {
    for (const c of data.contributors) {
      const prCount = c.prs.length;
      // For contributors with more than 1 PR, the README shows "N merged PRs"
      if (prCount > 1) {
        expect(readme).toContain(`${prCount} merged PR`);
      }
    }
  });
});

// ─── website/index.html acknowledgements section ────────────────────────────

describe("acknowledgements: website/index.html", () => {
  const html = readFileSync(WEBSITE, "utf-8");
  const data = JSON.parse(readFileSync(ACK_JSON, "utf-8"));

  test("website contains renderAcknowledgementsPage function", () => {
    expect(html).toContain("function renderAcknowledgementsPage()");
  });

  test("website contains all contributor logins", () => {
    for (const c of data.contributors) {
      expect(html).toContain(c.login);
    }
  });

  test("website contains all dependency names", () => {
    for (const d of data.dependencies) {
      expect(html).toContain(d.name);
    }
  });

  test("website PR arrays match JSON data", () => {
    for (const c of data.contributors) {
      // Check the JS array literal is present in the HTML
      const arrayStr = "[" + c.prs.join(",") + "]";
      expect(html).toContain(arrayStr);
    }
  });

  test("website references acknowledgements.json as source of truth", () => {
    expect(html).toContain("acknowledgements.json");
  });
});

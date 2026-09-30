#!/usr/bin/env python3
"""Measure a skill's context footprint and per-section size.

Usage:
    measure_skill.py <skill-path> [--json] [--out FILE]

Reports for <skill-path>/SKILL.md:
  * always-loaded footprint  - frontmatter name + description (every turn)
  * on-trigger footprint     - the SKILL.md body (every activation)
  * on-demand footprint      - references/, scripts/, agents/, assets/
  * every H2 section with its line and word count, largest first
  * a verdict against the 500-line AND 3000-word body caps

Exit codes:
    0  measurement completed (over-cap is reported, not an error)
    2  the target could not be measured (missing/unparsable SKILL.md)
"""

import argparse
import json
import re
import sys
from pathlib import Path

LINE_CAP = 500
WORD_CAP = 3000
ON_DEMAND_DIRS = ("references", "scripts", "agents", "assets")
CHARS_PER_TOKEN = 4  # rough estimate, labelled as such in the report


def die(msg, fix):
    print(f"Error: {msg}", file=sys.stderr)
    print(f"Fix:   {fix}", file=sys.stderr)
    sys.exit(2)


def split_frontmatter(text, skill_md):
    """Return (frontmatter_text, body_text, body_start_line) - 1-indexed."""
    if not text.startswith("---"):
        die(
            f"{skill_md} has no YAML frontmatter (file does not start with '---').",
            "Add a frontmatter block with at least 'name:' and 'description:'.",
        )
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.DOTALL)
    if not m:
        die(
            f"{skill_md} has an unterminated YAML frontmatter block.",
            "Close the frontmatter with a line containing exactly '---'.",
        )
    fm = m.group(1)
    body = text[m.end():]
    body_start = text[: m.end()].count("\n") + 1
    return fm, body, body_start


def frontmatter_field(fm_text, field, indented=False):
    """Read one scalar field without requiring PyYAML."""
    prefix = r"\s+" if indented else ""
    m = re.search(rf"^{prefix}{field}:\s*(.*)$", fm_text, re.MULTILINE)
    if not m:
        return None
    val = m.group(1).strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
        val = val[1:-1]
    return val


def measure_text(text):
    lines = text.splitlines()
    chars = len(text)
    return {
        "lines": len(lines),
        "words": len(text.split()),
        "chars": chars,
        "est_tokens": round(chars / CHARS_PER_TOKEN),
    }


def find_sections(body, body_start):
    """H2 sections of the body, ignoring '##' inside fenced code blocks.

    Content before the first H2 becomes a '(preamble)' pseudo-section so that
    every line of the body belongs to exactly one section.
    """
    lines = body.splitlines()
    fence = None
    heads = []
    for i, line in enumerate(lines):
        fm = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fm:
            tok = fm.group(1)[0]
            if fence is None:
                fence = tok
            elif fence == tok:
                fence = None
            continue
        if fence is None and re.match(r"^##\s+\S", line):
            heads.append((i, line.strip().lstrip("#").strip()))

    bounds = []
    if not heads or heads[0][0] > 0:
        bounds.append((0, heads[0][0] if heads else len(lines), "(preamble)"))
    for n, (idx, title) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(lines)
        bounds.append((idx, end, title))

    sections = []
    for start, end, title in bounds:
        chunk = "\n".join(lines[start:end])
        if not chunk.strip() and title == "(preamble)":
            continue
        sections.append(
            {
                "heading": title,
                "start_line": body_start + start,
                "end_line": body_start + end - 1,
                "lines": end - start,
                "words": len(chunk.split()),
            }
        )
    return sections


def measure_dir(path):
    if not path.is_dir():
        return {"files": 0, "lines": 0, "words": 0, "est_tokens": 0}
    files = [p for p in sorted(path.rglob("*")) if p.is_file() and not p.name.startswith(".")]
    lines = words = chars = 0
    for p in files:
        try:
            t = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        lines += len(t.splitlines())
        words += len(t.split())
        chars += len(t)
    return {
        "files": len(files),
        "lines": lines,
        "words": words,
        "est_tokens": round(chars / CHARS_PER_TOKEN),
    }


def build_report(skill_path):
    skill_md = skill_path / "SKILL.md"
    if not skill_md.is_file():
        die(
            f"no SKILL.md found at {skill_md}.",
            "Pass the skill's directory, e.g. measure_skill.py ~/.claude/skills/my-skill",
        )
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError as exc:
        die(f"could not read {skill_md}: {exc}", "Check file permissions and encoding (UTF-8 expected).")

    fm, body, body_start = split_frontmatter(text, skill_md)
    name = frontmatter_field(fm, "name") or skill_path.name
    desc = frontmatter_field(fm, "description") or ""
    version = frontmatter_field(fm, "version", indented=True)

    body_stats = measure_text(body)
    report = {
        "skill": name,
        "path": str(skill_path),
        "version": version,
        "always_loaded": {
            "description_chars": len(desc),
            "frontmatter_lines": len(fm.splitlines()),
            "est_tokens": round((len(name) + len(desc)) / CHARS_PER_TOKEN),
        },
        "on_trigger": dict(body_stats, start_line=body_start),
        "on_demand": {d: measure_dir(skill_path / d) for d in ON_DEMAND_DIRS},
        "sections": sorted(find_sections(body, body_start), key=lambda s: -s["lines"]),
        "caps": {
            "lines": {"value": body_stats["lines"], "cap": LINE_CAP, "over": body_stats["lines"] > LINE_CAP},
            "words": {"value": body_stats["words"], "cap": WORD_CAP, "over": body_stats["words"] > WORD_CAP},
        },
    }
    report["verdict"] = "OVER_CAP" if (report["caps"]["lines"]["over"] or report["caps"]["words"]["over"]) else "WITHIN_CAP"
    return report


def print_human(r):
    print(f"Skill: {r['skill']}  ({r['path']})")
    print()
    print("Footprint")
    a, t = r["always_loaded"], r["on_trigger"]
    print(f"  always-loaded (every turn)  description {a['description_chars']} chars, ~{a['est_tokens']} tokens")
    print(f"  on-trigger    (every run)   {t['lines']} lines, {t['words']} words, ~{t['est_tokens']} tokens")
    od = r["on_demand"]
    total = sum(v["est_tokens"] for v in od.values())
    detail = ", ".join(f"{d} {od[d]['files']}f/{od[d]['lines']}L" for d in ON_DEMAND_DIRS if od[d]["files"])
    print(f"  on-demand     (when read)   ~{total} tokens" + (f"  [{detail}]" if detail else "  [none]"))
    print()
    c = r["caps"]
    for key in ("lines", "words"):
        mark = "OVER" if c[key]["over"] else "ok"
        print(f"  body {key:<6} {c[key]['value']:>6} / {c[key]['cap']}  {mark}")
    print(f"  verdict: {r['verdict']}")
    print()
    print("Sections, largest first")
    print(f"  {'lines':>6} {'words':>7}  {'at':>5}  heading")
    for s in r["sections"]:
        print(f"  {s['lines']:>6} {s['words']:>7}  {s['start_line']:>5}  {s['heading']}")
    if r["verdict"] == "WITHIN_CAP":
        print()
        print("Body is within both caps. Shortening is optional - see the early exit in SKILL.md Phase 0.")


def main():
    ap = argparse.ArgumentParser(description="Measure a skill's context footprint and per-section size.")
    ap.add_argument("skill_path", help="path to the skill directory (the one containing SKILL.md)")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    ap.add_argument("--out", help="also write the JSON report to this file")
    args = ap.parse_args()

    report = build_report(Path(args.skill_path).expanduser())

    if args.out:
        out = Path(args.out).expanduser()
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        except OSError as exc:
            die(f"could not write report to {out}: {exc}", "Choose a writable path, e.g. --out .skill-shortener/baseline.json")
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_human(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())

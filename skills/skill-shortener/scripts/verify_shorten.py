#!/usr/bin/env python3
"""Verify a shortened skill against the behavior-preserving invariants.

Usage:
    verify_shorten.py <skill-path> --manifest FILE [--baseline FILE]

Manifest schema (written in Phase 1, one entry per baseline H2 section):

    {
      "target": "<skill-path>",
      "sections": [
        {"heading": "Overview", "disposition": "KEEP"},
        {"heading": "API errors", "disposition": "MOVE",
         "destination": "references/api-errors.md",
         "load_condition": "when the API returns a non-200"},
        {"heading": "History", "disposition": "CUT",
         "reason": "changelog and attribution; changes no behavior"}
      ]
    }

"destination" may be a string or a list of strings. Checks that need the
pre-shorten state (exhaustiveness, shrinkage, version bump) are skipped with a
warning when --baseline is omitted.

Exit codes:
    0  every applicable check passed
    1  at least one check failed (each failure prints what and how to fix it)
    2  the run could not start (missing skill, manifest, or malformed JSON)
"""

import argparse
import json
import re
import sys
from pathlib import Path

LINE_CAP = 500
WORD_CAP = 3000
DESC_TARGET = 250
POINTER_DIRS = ("references", "scripts", "assets", "agents")
ORPHAN_DIRS = ("references", "scripts")  # docs/, evals/, assets/, agents/ are not pointed to line-by-line
# Whole-word cues on the pointer line/header. Trailing spaces used to fake
# boundaries for "for"/"on a"; \b does that, and the destination path is
# stripped first so scripts/verify_*.py cannot pass via the "if" in "verify".
CONDITION_CUES = ("when", "if", "before", "after", "unless", "for", "on a", "whenever", "each time")
CONDITION_CUE_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(c) for c in CONDITION_CUES) + r")\b",
    re.IGNORECASE,
)
VALID = {"KEEP", "CUT", "MOVE"}


def die(msg, fix):
    print(f"Error: {msg}", file=sys.stderr)
    print(f"Fix:   {fix}", file=sys.stderr)
    sys.exit(2)


def load_json(path, what, fix):
    p = Path(path).expanduser()
    if not p.is_file():
        die(f"{what} not found at {p}.", fix)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        die(f"{what} at {p} is not readable JSON: {exc}", "Rewrite it as valid JSON - see the schema in this script's docstring.")


def read_body(skill_md):
    text = skill_md.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.DOTALL)
    if not m:
        die(f"{skill_md} has no parsable YAML frontmatter.", "Restore the '---' delimited frontmatter block at the top of the file.")
    return m.group(1), text[m.end():]


def field(fm, name, indented=False):
    prefix = r"\s+" if indented else ""
    m = re.search(rf"^{prefix}{name}:\s*(.*)$", fm, re.MULTILINE)
    if not m:
        return None
    v = m.group(1).strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    return v


def destinations(entry):
    d = entry.get("destination")
    if d is None:
        return []
    return [d] if isinstance(d, str) else list(d)


def confined_under(skill, rel):
    """Return the resolved path of `rel` if it stays inside `skill`, else None.

    POSIX `Path / rel` discards the skill root when `rel` is absolute, and
    `..` segments walk out of it. Both must fail the wiring checks rather
    than be treated as files under the skill.
    """
    if not isinstance(rel, str) or not rel.strip():
        return None
    candidate = Path(rel).expanduser()
    if candidate.is_absolute():
        return None
    root = skill.resolve()
    try:
        resolved = (skill / candidate).resolve()
        resolved.relative_to(root)
    except (OSError, ValueError):
        return None
    return resolved


def mentioned_paths(text):
    """Every references//scripts//assets//agents/ path the text mentions."""
    # (?<![\w./-]) keeps a path that is part of a longer path - another skill's
    # ~/.claude/skills/other/scripts/x.py, or ~/.agents/skills/ - from being read
    # as a local pointer.
    pat = rf"(?<![\w./-])(?:{'|'.join(POINTER_DIRS)})/[A-Za-z0-9._\-/]+"
    return {m.rstrip(".,;:)`'\"") for m in re.findall(pat, text)}


def text_without_destination(text, destination):
    """Pointer context with the destination path removed so the path is not cue text."""
    if not destination:
        return text
    return text.replace(destination, "")


def has_load_condition_cue(text, destination=""):
    """True when a CONDITION_CUE appears as a whole word outside `destination`."""
    return bool(CONDITION_CUE_RE.search(text_without_destination(text, destination)))


def lines_mentioning(text, needle):
    """Lines mentioning `needle`, each paired with its table header when the
    mention sits in a Markdown table - a 'Read it when' column header is a real
    load condition for every row under it."""
    lines = text.splitlines()
    out = []
    for i, ln in enumerate(lines):
        if needle not in ln:
            continue
        ctx = [ln]
        if ln.lstrip().startswith("|"):
            j = i
            while j > 0 and lines[j - 1].lstrip().startswith("|"):
                j -= 1
            ctx.append(lines[j])
        out.append(" ".join(ctx))
    return out


def main():
    ap = argparse.ArgumentParser(description="Verify a shortened skill's behavior-preserving invariants.")
    ap.add_argument("skill_path")
    ap.add_argument("--manifest", required=True, help="Phase 1 manifest JSON")
    ap.add_argument("--baseline", help="Phase 0 baseline JSON from measure_skill.py")
    args = ap.parse_args()

    skill = Path(args.skill_path).expanduser()
    skill_md = skill / "SKILL.md"
    if not skill_md.is_file():
        die(f"no SKILL.md at {skill_md}.", "Pass the skill directory, e.g. verify_shorten.py ~/.claude/skills/my-skill --manifest ...")

    manifest = load_json(args.manifest, "manifest", "Write it in Phase 1 - schema is in this script's docstring.")
    baseline = load_json(args.baseline, "baseline", "Produce it with: measure_skill.py <skill> --json --out .skill-shortener/baseline.json") if args.baseline else None

    fm, body = read_body(skill_md)
    entries = manifest.get("sections")
    if not isinstance(entries, list) or not entries:
        die("manifest has no 'sections' array.", "Add one entry per baseline H2 section - schema is in this script's docstring.")

    results = []   # (name, ok, detail)
    skipped = []
    warnings = []

    def check(name, ok, detail=""):
        results.append((name, ok, detail))

    # 1. every disposition is valid and carries its required fields
    bad = []
    for e in entries:
        h, d = e.get("heading", "?"), e.get("disposition")
        if d not in VALID:
            bad.append(f"{h!r}: disposition {d!r} is not one of KEEP/CUT/MOVE")
        elif d == "CUT" and not str(e.get("reason", "")).strip():
            bad.append(f"{h!r}: CUT with no 'reason'")
        elif d == "MOVE":
            if not destinations(e):
                bad.append(f"{h!r}: MOVE with no 'destination'")
            if not str(e.get("load_condition", "")).strip():
                bad.append(f"{h!r}: MOVE with no 'load_condition'")
    check("dispositions valid", not bad, "; ".join(bad[:4]))

    # 2. manifest accounts for every baseline section, exactly once
    if baseline:
        base = [s["heading"] for s in baseline.get("sections", [])]
        got = [e.get("heading", "") for e in entries]
        missing = [h for h in base if h not in got]
        dupes = sorted({h for h in got if got.count(h) > 1})
        extra = [h for h in got if h not in base]
        ok = not (missing or dupes)
        detail = "; ".join(
            filter(None, [
                f"unclassified: {missing[:4]}" if missing else "",
                f"classified twice: {dupes[:4]}" if dupes else "",
                f"(not in baseline, ignored: {extra[:3]})" if extra else "",
            ])
        )
        check(f"manifest exhaustive ({len(base)} sections)", ok, detail)
    else:
        skipped.append("manifest exhaustive (needs --baseline)")

    # 3. every MOVE destination exists and is non-empty
    missing_dest = []
    all_dest = []
    for e in entries:
        if e.get("disposition") != "MOVE":
            continue
        for d in destinations(e):
            p = confined_under(skill, d)
            if p is None:
                missing_dest.append(f"{d} (outside skill)")
                continue
            all_dest.append(d)
            if not p.is_file():
                missing_dest.append(f"{d} (missing)")
            elif not p.read_text(encoding="utf-8").strip():
                missing_dest.append(f"{d} (empty)")
    check(f"destinations written ({len(set(all_dest))})", not missing_dest, "; ".join(missing_dest[:4]))

    # 4. every destination is pointed to from SKILL.md
    unpointed = sorted({d for d in all_dest if d not in body})
    check("destinations pointed to", not unpointed, "; ".join(unpointed[:4]))

    # 5. every pointer carries a load condition (disclosure, not relocation)
    bare = []
    for d in sorted(set(all_dest)):
        pointer_lines = lines_mentioning(body, d)
        if pointer_lines and not any(has_load_condition_cue(ln, d) for ln in pointer_lines):
            bare.append(d)
    check("pointers state load conditions", not bare, "; ".join(f"{d}: no when/if/before cue" for d in bare[:3]))

    # 6. no dangling pointer
    dangling = sorted(
        p for p in mentioned_paths(body)
        if (loc := confined_under(skill, p)) is None or not loc.exists()
    )
    check("pointers resolve", not dangling,
          "; ".join(dangling[:4]) + " - create the file; write another skill's path in full (~/.claude/skills/<skill>/...); "
          "write an illustrative path as a placeholder (references/<name>.md) so it is not read as a pointer")

    # 7. no orphan file under references/ (hard) or scripts/ (advisory).
    #    A helper module a sibling script imports is reached through that script,
    #    not through SKILL.md, so it is not an orphan.
    def collect(d):
        root = skill / d
        return [p for p in sorted(root.rglob("*")) if p.is_file() and not p.name.startswith(".") and p.suffix != ".pyc"] if root.is_dir() else []

    script_files = collect("scripts")
    internal = set()
    for p in script_files:
        try:
            src = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for q in script_files:
            if q != p and (re.search(rf"\b(?:import|from)\s+\.?{re.escape(q.stem)}\b", src) or q.name in src):
                internal.add(q)

    ref_orphans = [p.relative_to(skill).as_posix() for p in collect("references") if p.relative_to(skill).as_posix() not in body]
    check("no orphan references", not ref_orphans, "; ".join(ref_orphans[:4]) + " - point at it from SKILL.md, or delete it")

    script_orphans = [
        p.relative_to(skill).as_posix() for p in script_files
        if p not in internal and p.name != "__init__.py" and p.relative_to(skill).as_posix() not in body
    ]
    if script_orphans:
        warnings.append(f"scripts not named in SKILL.md (fine if a sibling script calls them): {'; '.join(script_orphans[:4])}")

    # 8. references stay one level deep - no reference-to-reference chain
    chains = []
    refs = skill / "references"
    if refs.is_dir():
        for p in sorted(refs.rglob("*.md")):
            # A chain needs a real local target: an illustrative path in prose
            # ("Read references/api-errors.md when ...") is an example, not a hop.
            hits = {
                h for h in mentioned_paths(p.read_text(encoding="utf-8"))
                if h.startswith("references/")
                and h != p.relative_to(skill).as_posix()
                and (loc := confined_under(skill, h)) is not None
                and loc.is_file()
            }
            if hits:
                chains.append(f"{p.relative_to(skill).as_posix()} -> {sorted(hits)[:2]}")
    check("references one level deep", not chains, "; ".join(chains[:3]))

    # 9. body within BOTH caps
    n_lines, n_words = len(body.splitlines()), len(body.split())
    check(f"body within caps ({n_lines}L / {n_words}W)", n_lines <= LINE_CAP and n_words <= WORD_CAP,
          f"caps are {LINE_CAP} lines and {WORD_CAP} words")

    # 10. body actually got smaller
    if baseline:
        was = baseline.get("on_trigger", {})
        shrank = n_lines < was.get("lines", 0) or n_words < was.get("words", 0)
        check("body shrank", shrank, f"was {was.get('lines')}L / {was.get('words')}W, now {n_lines}L / {n_words}W")
    else:
        skipped.append("body shrank (needs --baseline)")

    # 11. description still valid and within the runtime target
    desc = field(fm, "description") or ""
    ok_desc = 0 < len(desc) <= DESC_TARGET and "\n" not in desc and "<" not in desc and ">" not in desc
    check(f"description intact ({len(desc)} chars)", ok_desc, f"must be non-empty, single line, no angle brackets, <= {DESC_TARGET} chars")

    # 12. version bumped
    if baseline:
        old, new = baseline.get("version"), field(fm, "version", indented=True)
        check("metadata.version bumped", bool(new) and new != old, f"was {old}, now {new} - minor for pure relocation, major if a CUT removed an instruction")
    else:
        skipped.append("metadata.version bumped (needs --baseline)")

    width = max(len(n) for n, _, _ in results)
    print(f"Verify: {skill}")
    print("." * (width + 22))
    for name, ok, detail in results:
        mark = "PASS" if ok else "FAIL"
        print(f"  {name:<{width}}  {mark}" + (f" - {detail}" if detail and not ok else ""))
    for s in skipped:
        print(f"  {s:<{width}}  SKIP")
    for w in warnings:
        print(f"  {'(warning)':<{width}}  {w}")
    failed = [n for n, ok, _ in results if not ok]
    print("-" * (width + 22))
    print(f"  Result: {'PASS' if not failed else 'FAIL'}  ({len(results) - len(failed)}/{len(results)} checks)")
    if failed:
        print(f"\nFix each FAIL above, then re-run this command. Failing checks: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

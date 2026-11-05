#!/usr/bin/env python3
"""Read a skill's version history from git and check its CHANGELOG.md.

Stdlib only. Three subcommands, all print JSON on stdout:

  skill_versions.py state   <skill-dir> [--accept-rename]   version state, range, changelog status
  skill_versions.py history <skill-dir> [--accept-rename]   every version transition in git history
  skill_versions.py check   <skill-dir>                     validate <skill-dir>/CHANGELOG.md

--accept-rename follows history across a folder rename that also changed the
skill's `name:` (reported as `rename_candidate`); pass it only after the user
confirms the old skill is the same skill.

Errors go to stderr as "Error: <what> (<input>). Fix: <how>." with exit 1.
`check` exits 1 when the changelog has findings; the JSON lists them.
Every git command printed by `state` uses `git -C <repo-root>`, so it works
from any working directory.
"""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
HEADING = re.compile(
    r"^## \[?(?P<ver>[^\]\s]+)\]?(?: - (?P<date>\S+))?(?: \[YANKED\])?\s*$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def fail(what: str, where: str, fix: str) -> None:
    print(f"Error: {what} ({where}). Fix: {fix}", file=sys.stderr)
    sys.exit(1)


def run_git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True,
                              text=True, check=False)
    except FileNotFoundError:
        fail("git is not installed", "PATH", "install git, then re-run")
        raise


def git(cwd: Path, *args: str, check: bool = True) -> str:
    res = run_git(cwd, *args)
    if check and res.returncode != 0:
        fail(f"git {' '.join(args)} failed: {res.stderr.strip()}", str(cwd),
             "run on a skill folder inside a git work tree")
    return res.stdout if res.returncode == 0 else ""


def frontmatter(text: str) -> dict:
    """Return name, version and whether frontmatter exists.

    version = metadata.version at metadata's first indent level, or a legacy
    top-level `version:`. Handles `metadata:  # comment` and flow maps.
    """
    out = {"name": None, "version": None, "has_frontmatter": False}
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return out
    out["has_frontmatter"] = True
    meta_indent = None
    in_meta = False
    top_version = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 0:
            in_meta = False
            m = re.match(r"^metadata:\s*(\{.*\})?\s*(#.*)?$", line)
            if m:
                in_meta = m.group(1) is None
                meta_indent = None
                if m.group(1):
                    fm = re.search(r"\bversion:\s*['\"]?([^'\",}\s]+)", m.group(1))
                    if fm:
                        out["version"] = fm.group(1)
                continue
            m = re.match(r"^name:\s*['\"]?([^'\"#\s]+)", line)
            if m:
                out["name"] = m.group(1)
            m = re.match(r"^version:\s*['\"]?([^'\"#\s]+)", line)
            if m:
                top_version = m.group(1)
            continue
        if in_meta:
            if meta_indent is None:
                meta_indent = indent
            if indent == meta_indent:
                m = re.match(r"^\s+version:\s*['\"]?([^'\"#\s]+)", line)
                if m:
                    out["version"] = m.group(1)
    if out["version"] is None:
        out["version"] = top_version
    return out


def semver_key(v: str | None) -> tuple[int, int, int] | None:
    m = SEMVER.match(v or "")
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def skill_dir_arg(argv: list[str]) -> Path:
    if len(argv) not in (3, 4) or (len(argv) == 4 and argv[3] != "--accept-rename"):
        fail("wrong arguments", " ".join(argv[1:]) or "none",
             "use: skill_versions.py state|history|check <skill-dir>")
    d = Path(argv[2]).expanduser().resolve()
    if not (d / "SKILL.md").is_file():
        fail("no SKILL.md found", str(d), "pass the skill folder that holds SKILL.md")
    return d


def has_commits(root: Path) -> bool:
    return run_git(root, "rev-parse", "--verify", "-q", "HEAD").returncode == 0


def head_path(root: Path, rel: str) -> str:
    """Path of this SKILL.md at HEAD, following an uncommitted (staged) rename."""
    if run_git(root, "cat-file", "-e", f"HEAD:{rel}").returncode == 0:
        return rel
    out = git(root, "diff", "--cached", "-M", "--name-status", "HEAD", check=False)
    for line in out.splitlines():
        parts = line.split("\t")
        if parts[0].startswith("R") and len(parts) == 3 and parts[2] == rel:
            return parts[1]
    return rel


def history(root: Path, rel: str, accept_rename: bool = False) -> tuple[list[dict], dict | None]:
    """Version transitions of SKILL.md at `rel` (a path at HEAD), oldest first.

    Follows renames. A name change inside the same folder is the same skill.
    A folder change that also changes `name:` may be a rename or a deleted
    look-alike skill that `--follow` paired with this one; git cannot tell
    them apart, so history stops there and the older side is returned as
    `rename_candidate`, unless accept_rename is set.
    """
    if not has_commits(root):
        return [], None
    out = git(root, "log", "--follow", "--date=short",
              "--format=%x00%H%x09%cd%x09%s", "--name-only", "--", rel, check=False)
    commits = []
    for block in out.split("\x00")[1:]:
        head, _, rest = block.partition("\n")
        sha, date, subject = (head.split("\t", 2) + ["", ""])[:3]
        names = [n for n in rest.splitlines() if n.strip()]
        commits.append((sha, date, subject, names[0] if names else rel))
    kept: list = []
    candidate = None
    name = None
    folder = None
    for sha, date, subject, path in commits:  # newest first
        text = git(root, "show", f"{sha}:{path}", check=False)
        fm = frontmatter(text) if text else {"name": None, "version": None}
        pdir = Path(path).parent.as_posix()
        if kept and fm["name"] and name and fm["name"] != name and pdir != folder \
                and not accept_rename:
            candidate = {"path": pdir, "name": fm["name"], "version": fm["version"],
                         "commit": sha}
            break
        name = fm["name"] or name
        folder = pdir
        kept.append((sha, date, subject, path, fm["version"]))
    transitions, prev = [], None
    for sha, date, subject, path, ver in reversed(kept):
        if ver and ver != prev:
            transitions.append({"version": ver, "previous": prev, "commit": sha,
                                "date": date, "subject": subject,
                                "path": Path(path).parent.as_posix()})
        if ver:
            prev = ver
    return transitions, candidate


def changelog_entries(d: Path) -> list[dict]:
    path = d / "CHANGELOG.md"
    if not path.is_file():
        return []
    entries = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.startswith("## "):
            m = HEADING.match(line)
            if m:
                entries.append({"version": m.group("ver"), "date": m.group("date"), "line": n})
            else:
                entries.append({"version": None, "date": None, "line": n, "raw": line})
    return entries


def pathspec(dirs: list[str], cl_dir: str) -> str:
    parts = [shlex.quote(p) for p in dict.fromkeys(dirs)]
    parts.append(shlex.quote(":(exclude,glob)**/CHANGELOG.md"))
    return "-- " + " ".join(parts)


def possible_rename(root: Path, rel: str, hpath: str) -> list[str]:
    """SKILL.md paths deleted (staged or not) while this SKILL.md is new to HEAD.

    A non-empty list means git has not paired this skill with its old folder,
    so its history cannot be trusted until the rename is staged as a rename.
    """
    if hpath != rel or run_git(root, "cat-file", "-e", f"HEAD:{rel}").returncode == 0:
        return []
    unstaged = git(root, "ls-files", "--deleted", "--", "*SKILL.md", check=False)
    staged = git(root, "diff", "--cached", "--diff-filter=D", "--name-only", "HEAD",
                 "--", "*SKILL.md", check=False)
    return sorted({p for p in (unstaged + staged).splitlines() if p.strip()})


def state(d: Path, accept_rename: bool = False) -> dict:
    root = Path(git(d, "rev-parse", "--show-toplevel").strip())
    rel = (d / "SKILL.md").relative_to(root).as_posix()
    rel_dir = Path(rel).parent.as_posix()
    fm = frontmatter((d / "SKILL.md").read_text(encoding="utf-8"))
    shallow = git(root, "rev-parse", "--is-shallow-repository", check=False).strip() == "true"
    commits = has_commits(root)
    hpath = head_path(root, rel) if commits else rel
    head_text = git(root, "show", f"HEAD:{hpath}", check=False) if commits else ""
    head = frontmatter(head_text)["version"] if head_text else None
    trans, candidate = history(root, hpath, accept_rename) if commits else ([], None)
    version = fm["version"]
    uncommitted = version is not None and version != head
    if uncommitted:
        base = trans[-1]["commit"] if trans else None
        end = "WORKTREE"
        previous = head
    else:
        base = trans[-2]["commit"] if len(trans) >= 2 else None
        end = trans[-1]["commit"] if trans else None
        previous = trans[-1]["previous"] if trans else None
    dirs = [t["path"] for t in trans[-2:]] + [Path(hpath).parent.as_posix(), rel_dir]
    spec = pathspec(dirs, rel_dir)
    g = f"git -C {shlex.quote(str(root))}"
    if base and end == "WORKTREE":
        diff_cmd = f"{g} diff -M {base} {spec}"
        log_cmd = f"{g} log --format='%h %cd %s' --date=short {base}..HEAD {spec}"
    elif base:
        diff_cmd = f"{g} diff -M {base} {end} {spec}"
        log_cmd = f"{g} log --format='%h %cd %s' --date=short {base}..{end} {spec}"
    else:
        diff_cmd = log_cmd = None
    exists = (d / "CHANGELOG.md").is_file()
    released = [e["version"] for e in changelog_entries(d)
                if e["version"] not in (None, "Unreleased")]
    hist_versions = [t["version"] for t in trans]
    top = released[0] if released else None
    phantom = bool(uncommitted and top and top != version and top not in hist_versions
                   and semver_key(top) and semver_key(head)
                   and semver_key(top) > semver_key(head))
    vk, pk = semver_key(version), semver_key(previous)
    return {
        "skill_dir": str(d),
        "repo_root": str(root),
        "name": fm["name"],
        "has_frontmatter": fm["has_frontmatter"],
        "version": version,
        "valid_semver": bool(vk),
        "head_version": head,
        "previous_version": previous,
        "downgrade": bool(vk and pk and vk < pk),
        "uncommitted_bump": uncommitted,
        "shallow": shallow,
        "has_commits": commits,
        "renamed_from": Path(hpath).parent.as_posix() if hpath != rel else None,
        "unpaired_deletions": possible_rename(root, rel, hpath) if commits else [],
        "rename_candidate": candidate,
        "skill_at_repo_root": rel_dir == ".",
        "base": base,
        "end": end,
        "diff_cmd": diff_cmd,
        "log_cmd": log_cmd,
        "dirty_cmd": f"{g} status --porcelain --untracked-files=all {spec}",
        "versions_in_history": len(trans),
        "changelog_exists": exists,
        "recorded": version in released,
        "recorded_on_top": bool(top) and top == version,
        "phantom_top_entry": top if phantom else None,
        # Versions from git history (excluding the current one) with no entry.
        "missing_versions": list(dict.fromkeys(
            v for v in hist_versions if v != version and v not in released)),
    }


def check(d: Path) -> dict:
    current = frontmatter((d / "SKILL.md").read_text(encoding="utf-8"))["version"]
    path = d / "CHANGELOG.md"
    findings: list[str] = []
    if not path.is_file():
        return {"ok": False, "findings": [f"{path} does not exist"], "entries": []}
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "# Changelog":
        findings.append("line 1 must be '# Changelog'")
    entries = changelog_entries(d)
    for e in entries:
        if e["version"] is None:
            findings.append(f"line {e['line']}: heading is not '## [X.Y.Z] - YYYY-MM-DD': {e['raw']!r}")
        elif e["version"] != "Unreleased":
            if not semver_key(e["version"]):
                findings.append(f"line {e['line']}: version {e['version']!r} is not MAJOR.MINOR.PATCH")
            if not e["date"] or not DATE.match(e["date"]):
                findings.append(f"line {e['line']}: version {e['version']} needs a date as YYYY-MM-DD")
    released = [e for e in entries if e["version"] not in (None, "Unreleased")]
    seen: set[str] = set()
    for e in released:
        if e["version"] in seen:
            findings.append(f"line {e['line']}: duplicate entry for {e['version']}")
        seen.add(e["version"])
    keys = [semver_key(e["version"]) for e in released]
    for a, b, e in zip(keys, keys[1:], released[1:]):
        if a and b and not a > b:
            findings.append(f"line {e['line']}: {e['version']} is not older than the entry above it")
    if not released:
        findings.append("no released version entry found")
    elif current and released[0]["version"] != current:
        findings.append(f"top entry is {released[0]['version']} but SKILL.md metadata.version is {current}")
    return {"ok": not findings, "current_version": current, "findings": findings,
            "entries": [{k: v for k, v in e.items() if k != "raw"} for e in entries]}


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in {"state", "history", "check"}:
        fail("unknown or missing subcommand", " ".join(argv[1:]) or "none",
             "use: skill_versions.py state|history|check <skill-dir>")
    d = skill_dir_arg(argv)
    accept = len(argv) == 4
    if argv[1] == "state":
        print(json.dumps(state(d, accept), indent=2))
        return 0
    if argv[1] == "history":
        root = Path(git(d, "rev-parse", "--show-toplevel").strip())
        rel = (d / "SKILL.md").relative_to(root).as_posix()
        trans, _ = history(root, head_path(root, rel) if has_commits(root) else rel, accept)
        print(json.dumps(trans, indent=2))
        return 0
    result = check(d)
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        print("Error: CHANGELOG.md has findings (see JSON 'findings'). "
              "Fix: correct each listed line, then re-run check.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

#!/usr/bin/env python3
"""Regression: load-condition cues are whole words and ignore the destination path."""

from verify_shorten import has_load_condition_cue

DEST = "scripts/verify_shorten.py"
assert not has_load_condition_cue(f"See `{DEST}`", DEST), "path substring 'if'/'verify' must not count"
assert not has_load_condition_cue("See `references/verification.md`", "references/verification.md")
assert not has_load_condition_cue("See `scripts/when-to-run.py`", "scripts/when-to-run.py"), "filename 'when' must not count"
assert has_load_condition_cue(f"See `{DEST}` when the body is over cap", DEST)
assert has_load_condition_cue("Read it if the API returns non-200", "references/api.md")
print("ok")

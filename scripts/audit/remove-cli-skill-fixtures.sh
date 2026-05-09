#!/usr/bin/env bash
# remove-cli-skill-fixtures.sh
#
# Remove test-fixture skill directories left behind by automated CLI tests.
# These follow the pattern: ~/.claude/skills/cli-skill-for-{name}-{6-char-suffix}
# where SKILL.md is a tiny stub (< 200 bytes).
#
# Documented in docs/security/skill-audit-269.md.
#
# Safety:
#   - Refuses to operate outside $HOME/.claude/skills.
#   - Only matches the exact regex pattern below.
#   - Only deletes if the directory contains nothing but a SKILL.md under 200 bytes.
#   - --dry-run prints what would be removed without touching anything.

set -euo pipefail

DRY_RUN=0
case "${1:-}" in
  --dry-run|-n) DRY_RUN=1 ;;
  --help|-h)
    cat <<'EOF'
remove-cli-skill-fixtures.sh

Remove test-fixture skill directories left behind by automated CLI tests.
These follow the pattern: ~/.claude/skills/cli-skill-for-{name}-{6-char-suffix}
where SKILL.md is a tiny stub (< 200 bytes).

Documented in docs/security/skill-audit-269.md.

Safety:
  - Refuses to operate outside $HOME/.claude/skills.
  - Only matches the exact regex pattern below.
  - Only deletes if the directory contains nothing but a SKILL.md under 200 bytes.
  - --dry-run prints what would be removed without touching anything.

Usage:
  remove-cli-skill-fixtures.sh            Remove fixtures
  remove-cli-skill-fixtures.sh --dry-run  Preview without deleting
  remove-cli-skill-fixtures.sh --help     Show this help
EOF
    exit 0
    ;;
  "") ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
esac

SKILLS_DIR="${HOME}/.claude/skills"
PATTERN='^cli-skill-for-(export|export2|force|json|modify|noover|remove|remove2)-[A-Za-z0-9]{6}$'

if [ ! -d "$SKILLS_DIR" ]; then
  echo "✗ $SKILLS_DIR does not exist — nothing to do."
  exit 0
fi

# Resolve $SKILLS_DIR through any symlinks so the path-containment check below
# compares resolved-path against resolved-path. Without this, a setup that has
# ~/.claude as a symlink (common with dotfile managers) would fail every entry.
SKILLS_DIR="$(cd "$SKILLS_DIR" && pwd -P)"

removed=0
skipped=0
for d in "$SKILLS_DIR"/cli-skill-for-*; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"

  if ! [[ "$name" =~ $PATTERN ]]; then
    echo "○ skip (name doesn't match strict regex): $name"
    skipped=$((skipped + 1))
    continue
  fi

  # Resolve to a real path under SKILLS_DIR — refuse symlink-escapes
  real="$(cd "$d" && pwd -P)"
  case "$real" in
    "$SKILLS_DIR"/*) ;;
    *) echo "✗ refuse (resolved outside skills dir): $real"; skipped=$((skipped + 1)); continue ;;
  esac

  # Sanity: ensure it's a stub — only SKILL.md, nothing else, under 200 bytes
  entries="$(find "$d" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
  if [ "$entries" != "1" ]; then
    echo "○ skip (not a stub — $entries entries): $name"
    skipped=$((skipped + 1))
    continue
  fi
  if [ ! -f "$d/SKILL.md" ]; then
    echo "○ skip (no SKILL.md): $name"
    skipped=$((skipped + 1))
    continue
  fi
  size="$(wc -c < "$d/SKILL.md" | tr -d ' ')"
  if [ "$size" -gt 200 ]; then
    echo "○ skip (SKILL.md too large — $size bytes): $name"
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "would remove: $d"
  else
    # Remove only the specific file we just stat'd, then rmdir — narrower than
    # rm -rf so we won't follow a symlink swap or descend into anything other
    # than the validated stub.
    rm -- "$d/SKILL.md"
    rmdir -- "$d"
    echo "✓ removed: $d"
  fi
  removed=$((removed + 1))
done

echo
if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: $removed candidate(s), $skipped skipped. Re-run without --dry-run to apply."
else
  echo "Done: $removed removed, $skipped skipped."
fi

#!/usr/bin/env python3
"""
Quick validation script for skills - minimal version
"""

import sys
import os
import re
import yaml
from pathlib import Path

def validate_skill(skill_path):
    """Basic validation of a skill"""
    skill_path = Path(skill_path)

    # Check SKILL.md exists
    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        return False, "SKILL.md not found"

    # Read and validate frontmatter
    content = skill_md.read_text()
    if not content.startswith('---'):
        return False, "No YAML frontmatter found"

    # Extract frontmatter
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format"

    frontmatter_text = match.group(1)

    # Parse YAML frontmatter
    try:
        frontmatter = yaml.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return False, "Frontmatter must be a YAML dictionary"
    except yaml.YAMLError as e:
        return False, f"Invalid YAML in frontmatter: {e}"

    # Define allowed properties
    ALLOWED_PROPERTIES = {'name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility', 'effort', 'dependencies'}

    # Validate effort field if present (optional)
    effort = frontmatter.get('effort', None)
    if effort is not None:
        VALID_EFFORT_LEVELS = {'low', 'medium', 'high', 'xhigh', 'max'}
        if not isinstance(effort, str):
            return False, f"Effort must be a string, got {type(effort).__name__}"
        if effort not in VALID_EFFORT_LEVELS:
            return False, f"Effort '{effort}' is not valid. Allowed values: {', '.join(sorted(VALID_EFFORT_LEVELS))}"

    dependencies = frontmatter.get('dependencies', None)
    if dependencies is not None:
        if not isinstance(dependencies, list) or not dependencies:
            return False, "Dependencies must be a non-empty YAML list"
        if any(not isinstance(dependency, str) or not dependency.strip() for dependency in dependencies):
            return False, "Each dependency must be a non-empty skill reference string"

    # Check for unexpected properties (excluding nested keys under metadata)
    unexpected_keys = set(frontmatter.keys()) - ALLOWED_PROPERTIES
    if unexpected_keys:
        return False, (
            f"Unexpected key(s) in SKILL.md frontmatter: {', '.join(sorted(unexpected_keys))}. "
            f"Allowed properties are: {', '.join(sorted(ALLOWED_PROPERTIES))}"
        )

    # Check required fields
    if 'name' not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if 'description' not in frontmatter:
        return False, "Missing 'description' in frontmatter"

    # Extract name for validation
    name = frontmatter.get('name', '')
    if not isinstance(name, str):
        return False, f"Name must be a string, got {type(name).__name__}"
    name = name.strip()
    if name:
        # Check naming convention (kebab-case: lowercase with hyphens)
        if not re.match(r'^[a-z0-9-]+$', name):
            return False, f"Name '{name}' should be kebab-case (lowercase letters, digits, and hyphens only)"
        if name.startswith('-') or name.endswith('-') or '--' in name:
            return False, f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens"
        # Check name length (max 64 characters per spec)
        if len(name) > 64:
            return False, f"Name is too long ({len(name)} characters). Maximum is 64 characters."

    # Extract and validate description
    description = frontmatter.get('description', '')
    if not isinstance(description, str):
        return False, f"Description must be a string, got {type(description).__name__}"
    description = description.strip()
    if description:
        # Description must be a single line (no newlines) for correct parsing by external tools
        if '\n' in description or '\r' in description:
            return False, "Description must be a single line (no newlines or line breaks). This is required for correct parsing by external tools and automation."
        # Check for angle brackets
        if '<' in description or '>' in description:
            return False, "Description cannot contain angle brackets (< or >)"
        # Check description length (max 1024 characters per spec)
        if len(description) > 1024:
            return False, f"Description is too long ({len(description)} characters). Maximum is 1024 characters."
        # Soft warning: descriptions over 250 chars often get truncated tail-first
        # by the runtime when the harness exceeds its skills context budget (~2%).
        # Tail-first truncation tends to chop off the negative-trigger clause,
        # which is the part that prevents false-positive triggering.
        # See references/description-guide.md "Description length budget" for guidance.
        DESCRIPTION_RUNTIME_TARGET = 250
        if len(description) > DESCRIPTION_RUNTIME_TARGET:
            print(
                f"WARNING: description is {len(description)} characters, over the "
                f"recommended runtime target of {DESCRIPTION_RUNTIME_TARGET}. "
                "When the harness exceeds its skills context budget, descriptions "
                "get truncated tail-first — usually chopping the negative-trigger "
                "clause. Consider trimming. See skill-creator "
                "references/description-guide.md 'Description length budget' "
                "for techniques.",
                file=sys.stderr,
            )
        # Warn (non-fatal) if the description appears to lack a "negative trigger" clause.
        # Descriptions benefit from explicitly naming adjacent domains that should NOT
        # trigger the skill — this reduces false positives. See SKILL.md "Writing a good
        # description" for guidance and examples.
        negative_trigger_pattern = re.compile(
            r"don'?t use (?:for|when|if|on)"
            r"|not (?:for|intended for|suitable for|meant for)\b"
            r"|skip (?:for|when|if)"
            r"|avoid (?:using )?(?:for|when|on)"
            r"|never (?:use )?for\b"
            r"|only (?:use )?for\b",
            re.IGNORECASE,
        )
        if not negative_trigger_pattern.search(description):
            print(
                "WARNING: description appears to lack a negative-trigger clause "
                "(e.g., \"Don't use for X, Y, Z\"). Consider naming adjacent domains "
                "that should NOT trigger this skill to reduce false positives. "
                "See skill-creator SKILL.md 'Writing a good description' for examples.",
                file=sys.stderr,
            )

    # Validate compatibility field if present (optional)
    compatibility = frontmatter.get('compatibility', '')
    if compatibility:
        if not isinstance(compatibility, str):
            return False, f"Compatibility must be a string, got {type(compatibility).__name__}"
        if len(compatibility) > 500:
            return False, f"Compatibility is too long ({len(compatibility)} characters). Maximum is 500 characters."

    return True, "Skill is valid!"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)

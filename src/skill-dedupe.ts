/**
 * Within-repo dedupe for skills that share a name across multiple supported
 * skill directories (e.g., a repo that ships both `skills/foo/` and
 * `.claude/skills/foo/`). Issue #265.
 *
 * Priority order, falling through on miss:
 *   1. `skills/`
 *   2. `.claude/skills/`
 *   3. `.agent/skills/` (and `.agents/skills/`)
 *   4. First occurrence found
 *
 * Cross-repo duplicates are unaffected — this operates on a single repo's
 * discovered set.
 */

export type DedupeRoot =
  | "skills/"
  | ".claude/skills/"
  | ".agent/skills/"
  | ".agents/skills/"
  | "(other)";

export interface DedupeDecision {
  name: string;
  kept: { relPath: string; root: DedupeRoot };
  dropped: Array<{ relPath: string; root: DedupeRoot }>;
  reason: string;
}

export interface DedupeResult<T> {
  kept: T[];
  decisions: DedupeDecision[];
}

interface RootInfo {
  priority: number;
  root: DedupeRoot;
}

function categorize(relPath: string): RootInfo {
  if (relPath === "skills" || relPath.startsWith("skills/")) {
    return { priority: 1, root: "skills/" };
  }
  if (relPath === ".claude/skills" || relPath.startsWith(".claude/skills/")) {
    return { priority: 2, root: ".claude/skills/" };
  }
  if (relPath === ".agent/skills" || relPath.startsWith(".agent/skills/")) {
    return { priority: 3, root: ".agent/skills/" };
  }
  if (relPath === ".agents/skills" || relPath.startsWith(".agents/skills/")) {
    return { priority: 3, root: ".agents/skills/" };
  }
  return { priority: 4, root: "(other)" };
}

export function dedupeSkillsByName<T extends { name: string; relPath: string }>(
  skills: T[],
): DedupeResult<T> {
  const groups = new Map<string, T[]>();
  for (const skill of skills) {
    const existing = groups.get(skill.name);
    if (existing) {
      existing.push(skill);
    } else {
      groups.set(skill.name, [skill]);
    }
  }

  const kept: T[] = [];
  const decisions: DedupeDecision[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);

    const group = groups.get(skill.name)!;
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }

    let bestIndex = 0;
    let bestCat = categorize(group[0].relPath);
    for (let i = 1; i < group.length; i++) {
      const cat = categorize(group[i].relPath);
      if (cat.priority < bestCat.priority) {
        bestIndex = i;
        bestCat = cat;
      }
    }

    const best = group[bestIndex];
    kept.push(best);
    decisions.push({
      name: skill.name,
      kept: { relPath: best.relPath, root: bestCat.root },
      dropped: group
        .filter((_, i) => i !== bestIndex)
        .map((s) => ({ relPath: s.relPath, root: categorize(s.relPath).root })),
      reason:
        bestCat.priority === 4
          ? "first occurrence (no priority match)"
          : `${bestCat.root} priority`,
    });
  }

  return { kept, decisions };
}

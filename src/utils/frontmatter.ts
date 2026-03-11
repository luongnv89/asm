export function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  let inFrontmatter = false;
  let foundFirst = false;

  for (const line of lines) {
    if (line.trim() === "---") {
      if (!foundFirst) {
        foundFirst = true;
        inFrontmatter = true;
        continue;
      } else {
        break;
      }
    }

    if (inFrontmatter) {
      const match = line.match(/^(\w[\w-]*):\s*"?(.+?)"?\s*$/);
      if (match) {
        result[match[1]] = match[2];
      }
    }
  }

  return result;
}

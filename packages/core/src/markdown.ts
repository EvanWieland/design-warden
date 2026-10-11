/** The section of a markdown file under `## heading` (or the whole file), capped. */
export function guidanceExcerpt(markdown: string, section: string | undefined, max = 4000): string {
  let text = markdown;
  if (section) {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === section.toLowerCase());
    if (start >= 0) {
      const level = /^#+/.exec(lines[start]!)![0].length;
      const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= level);
      text = lines.slice(start, end < 0 ? undefined : end).join('\n');
    }
  }
  return text.length > max ? `${text.slice(0, max)}\n... (truncated)` : text;
}

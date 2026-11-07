export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'open'; text: string }
  | { kind: 'sealed'; width: number; reason: string };

const MARKUP = /\[\[(.+?)\]\]|\{\{(\d+)\|(.+?)\}\}/g;

/**
 * Parses case file copy. `[[text]]` is a bar that lifts to show its text. `{{12|reason}}` is a bar
 * twelve characters wide that never lifts. Sealed bars carry a reason, not content, so the private
 * detail cannot reach the page, not even in its source.
 */
export function parseRedactions(source: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of source.matchAll(MARKUP)) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', text: source.slice(cursor, match.index) });
    }
    const [whole, open, width, reason] = match;
    if (open !== undefined) {
      segments.push({ kind: 'open', text: open });
    } else if (width !== undefined && reason !== undefined) {
      segments.push({ kind: 'sealed', width: Number(width), reason });
    }
    cursor = match.index + whole.length;
  }
  if (cursor < source.length) segments.push({ kind: 'text', text: source.slice(cursor) });
  return segments;
}

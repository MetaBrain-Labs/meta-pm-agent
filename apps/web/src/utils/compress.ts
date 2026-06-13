/**
 * Parser for <compress>...</compress> blocks the agent emits to
 * show compressed/large content in a collapsible card.
 *
 * Format:
 *   <compress title="可选标题">
 *   compressed content here...
 *   </compress>
 */

export function splitCompressed(text: string): { kind: "text"; text: string } | { kind: "compress"; raw: string } | null {
  // already checked in the caller
  return parseCompressTag(text);
}

/** Split text into prose + compress segments. */
export type CompressSegment =
  | { kind: "text"; text: string }
  | { kind: "compress"; raw: string; title?: string };

export function splitOnCompressed(input: string): CompressSegment[] {
  const re = /<compress\b([^>]*)>([\s\S]*?)<\/compress>/gi;
  const out: CompressSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", text: input.slice(lastIndex, m.index) });
    }
    const attrs = parseAttrs(m[1] ?? "");
    out.push({ kind: "compress", raw: m[2]?.trim() ?? "", title: attrs.title });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < input.length) {
    out.push({ kind: "text", text: input.slice(lastIndex) });
  }
  return out;
}

function parseAttrs(raw: string): Record<string, string> {
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1] as string] = (m[2] ?? m[3] ?? "") as string;
  }
  return out;
}

/** Detect if any <compress> tags exist in the text */
export function hasCompressTag(text: string): boolean {
  return /<compress\b/i.test(text);
}

function parseCompressTag(text: string) {
  const re = /<compress\b([^>]*)>([\s\S]*?)<\/compress>/i;
  const m = re.exec(text);
  if (!m) return null;
  const attrs = parseAttrs(m[1] ?? "");
  return { kind: "compress" as const, raw: m[2]?.trim() ?? "", title: attrs.title };
}

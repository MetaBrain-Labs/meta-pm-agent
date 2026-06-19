/**
 * A pocket-sized markdown renderer for assistant chat messages.
 *
 * We deliberately avoid a full parser library — chat output rarely uses
 * the long tail of markdown features and a hand-rolled walker keeps the
 * bundle slim. Block-level: ATX headings (# … ###), fenced code (```),
 * ordered (1.) and unordered (- / *) lists, paragraphs, blank-line
 * separation. Inline: backtick code spans, **bold**, *italic* / _italic_,
 * and bare links (autolinked URLs).
 *
 * Output is a React fragment of typed elements — no dangerouslySetInnerHTML,
 * so untrusted text can't smuggle markup through.
 */
import { Fragment, useState, useCallback, type ReactNode } from "react";
import { Button } from "antd";
import { CopyOutlined } from "@ant-design/icons";

export function renderMarkdown(input: string): ReactNode {
  const blocks = parseBlocks(input);
  return <>{blocks.map((b, i) => renderBlock(b, i))}</>;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "code"; lang: string | null; body: string }
  | { kind: "hr" };

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Fenced code block.
    const fence = /^```(\w[\w+-]*)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? null;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      // Skip the closing fence (if present).
      if (i < lines.length) i++;
      out.push({ kind: "code", lang, body: buf.join("\n") });
      continue;
    }
    // ATX heading.
    const heading = /^(#{1,4})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3 | 4;
      out.push({ kind: "h", level, text: heading[2]! });
      i++;
      continue;
    }
    // Horizontal rule.
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }
    if (isTableStart(lines, i)) {
      const headers = splitTableRow(lines[i] ?? "");
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        rows.push(
          normalizeTableRow(splitTableRow(lines[i] ?? ""), headers.length),
        );
        i++;
      }
      out.push({ kind: "table", headers, rows });
      continue;
    }
    // Unordered list. Group consecutive items.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push({ kind: "ul", items });
      continue;
    }
    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push({ kind: "ol", items });
      continue;
    }
    // Paragraph: greedy until a blank line or another block-starter.
    const buf: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "") break;
      if (/^```/.test(next)) break;
      if (/^#{1,4}\s+/.test(next)) break;
      if (isTableStart(lines, i)) break;
      if (/^\s*[-*+]\s+/.test(next)) break;
      if (/^\s*\d+\.\s+/.test(next)) break;
      buf.push(next);
      i++;
    }
    out.push({ kind: "p", text: buf.join("\n") });
  }
  return out;
}

function renderBlock(block: Block, key: number): ReactNode {
  if (block.kind === "p") {
    return (
      <p key={key} className="my-0.5">
        {renderInline(block.text)}
      </p>
    );
  }
  if (block.kind === "h") {
    const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
    return (
      <Tag
        key={key}
        className="my-1.5 leading-tight"
        style={{
          fontFamily: 'var(--sans)',
          fontWeight: block.level <= 2 ? 700 : 600,
          fontSize:
            block.level === 1
              ? 20
              : block.level === 2
                ? 17
                : block.level === 3
                  ? 15
                  : 13,
          color: 'var(--ink)',
          letterSpacing: '-0.014em',
          borderBottom:
            block.level === 1 ? '1px solid var(--line-soft)' : undefined,
          paddingBottom: block.level === 1 ? 6 : undefined,
          lineHeight: 1.2,
        }}
      >
        {renderInline(block.text)}
      </Tag>
    );
  }
  if (block.kind === "ul") {
    return (
      <ul key={key} className="my-0.5 pl-5">
        {block.items.map((item, i) => (
          <li key={i} className="my-0.5">
            {renderInline(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "ol") {
    return (
      <ol key={key} className="my-0.5 pl-5">
        {block.items.map((item, i) => (
          <li key={i} className="my-0.5">
            {renderInline(item)}
          </li>
        ))}
      </ol>
    );
  }
  if (block.kind === "table") {
    return (
      <div
        key={key}
        className="my-2 max-w-full overflow-x-auto rounded-md border border-[var(--line-soft)]"
      >
        <table className="min-w-full border-collapse text-left text-[13px]">
          <thead className="bg-[var(--surface-muted)]">
            <tr>
              {block.headers.map((header, index) => (
                <th
                  key={index}
                  className="border-b border-[var(--line-soft)] px-3 py-2 font-bold text-[var(--ink)]"
                >
                  {renderInline(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-[var(--line-soft)] last:border-b-0"
              >
                {block.headers.map((_, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="max-w-[320px] align-top px-3 py-2 text-[var(--ink-soft)]"
                  >
                    {renderInline(row[cellIndex] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.kind === "code") {
    return <CodeBlock key={key} lang={block.lang} body={block.body} />;
  }
  if (block.kind === "hr") {
    return <hr key={key} className="md-hr" />;
  }
  return null;
}

/**
 * 判断当前位置是否是标准 Markdown 表格的开头。
 */
function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return isTableRow(header) && isTableSeparator(separator);
}

/**
 * 判断一行是否形如 Markdown 表格行。
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && /^\|?.+\|.+\|?$/.test(trimmed);
}

/**
 * 判断一行是否是 Markdown 表格分隔行。
 */
function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

/**
 * 拆分 Markdown 表格行，并去掉可选的首尾竖线。
 */
function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * 对齐行单元格数量，避免短行导致渲染错位。
 */
function normalizeTableRow(row: string[], length: number): string[] {
  if (row.length >= length) return row.slice(0, length);
  return [...row, ...Array.from({ length: length - row.length }, () => "")];
}

// Inline pass: tokenize into runs of `code`, **bold**, *italic*, links,
// and plain text. We walk the string with a regex that matches whichever
// delimiter shows up next; everything between delimiters becomes a text
// span (which itself still gets autolink scanning).
function renderInline(text: string): ReactNode {
  const out: ReactNode[] = [];
  // Order matters: inline code first so its contents are not re-tokenized
  // as bold/italic.
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) {
      pushText(out, text.slice(lastIndex, m.index), key++);
    }
    if (m[1]) {
      out.push(
        <code key={key++} className="md-inline-code">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={key++}>{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<strong key={key++}>{m[3].slice(2, -2)}</strong>);
    } else if (m[4]) {
      out.push(<em key={key++}>{m[4].slice(1, -1)}</em>);
    } else if (m[5]) {
      out.push(<em key={key++}>{m[5].slice(1, -1)}</em>);
    } else if (m[6] && m[7]) {
      out.push(
        <a
          key={key++}
          className="md-link"
          href={m[7]}
          target="_blank"
          rel="noreferrer noopener"
        >
          {m[6]}
        </a>,
      );
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    pushText(out, text.slice(lastIndex), key++);
  }
  return <Fragment>{out}</Fragment>;
}

// Walk a plain text run, autolinking bare URLs and preserving the rest as
// text nodes. Newlines inside a paragraph become explicit <br />s — the
// upstream parser has already left them in place because chat output
// often relies on hard line breaks rather than blank-line separation.
function pushText(out: ReactNode[], text: string, baseKey: number): void {
  if (!text) return;
  const urlRe = /(https?:\/\/[^\s)]+)/g;
  const segments: ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = urlRe.exec(text))) {
    if (m.index > lastIndex) {
      segments.push(
        ...withBreaks(text.slice(lastIndex, m.index), `${baseKey}-${k++}`),
      );
    }
    segments.push(
      <a
        key={`${baseKey}-${k++}`}
        className="md-link"
        href={m[1]}
        target="_blank"
        rel="noreferrer noopener"
      >
        {m[1]}
      </a>,
    );
    lastIndex = urlRe.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push(...withBreaks(text.slice(lastIndex), `${baseKey}-${k++}`));
  }
  out.push(<Fragment key={baseKey}>{segments}</Fragment>);
}

function withBreaks(text: string, baseKey: string): ReactNode[] {
  const parts = text.split("\n");
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(<br key={`${baseKey}-br-${i}`} />);
    if (part) out.push(<Fragment key={`${baseKey}-t-${i}`}>{part}</Fragment>);
  });
  return out;
}

function CodeBlock({ lang, body }: { lang: string | null; body: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = body;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [body]);

  return (
    <div className="md-code-block">
      <div className="md-code-head">
        <span className="md-code-lang">{lang ?? "text"}</span>
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          style={{
            fontSize: 11,
            color: 'var(--ink-faint)',
            height: 'auto',
            padding: '0 6px',
            fontFamily: 'var(--sans)',
          }}
        >
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      <pre className="md-code">
        <code>{body}</code>
      </pre>
    </div>
  );
}

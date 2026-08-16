/**
 * 助手消息 Markdown 渲染器
 *
 * 使用 react-markdown 和 remark-gfm 渲染 Agent 输出的 Markdown 内容，并保留
 * Web Search 引用增强、显式 source 标记、代码块复制按钮和项目现有样式类名。
 *
 * Responsibilities:
 * - 渲染 GFM Markdown，包括表格、列表、链接、代码块和行内格式
 * - 在文档预览场景启用后，将 echarts/prototype/html 代码块渲染为图表或原型
 * - 将 [[source:id]] 标记转换成可点击引用图标
 * - 为可匹配搜索来源的段落和标题追加引用入口
 *
 * Notes:
 * - 不使用 dangerouslySetInnerHTML，Markdown 内容由 React 组件树渲染。
 */

import { isValidElement, useCallback, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Tooltip } from "antd";
import { CopyOutlined, LinkOutlined } from "@ant-design/icons";
import {
  DocumentVisualBlock,
  isDocumentVisualLanguage,
} from "../components/DocumentVisualBlocks";

/**
 * 联网搜索结果在正文中可引用的来源信息。
 */
export interface MarkdownCitationSource {
  sourceId?: string;
  title: string;
  url: string;
  snippet?: string;
}

/**
 * Markdown 渲染时可选的增强数据。
 */
interface RenderMarkdownOptions {
  citationSources?: MarkdownCitationSource[];
  /** 是否渲染文档可视化块（echarts/prototype/html），默认关闭以保持聊天轻量。 */
  enableVisualizations?: boolean;
}

/**
 * 渲染 Agent 输出的 Markdown 文本。
 */
export function renderMarkdown(
  input: string,
  options: RenderMarkdownOptions = {},
): ReactNode {
  return <MarkdownContent input={input} options={options} />;
}

/**
 * react-markdown 组件壳，集中配置 GFM 插件和自定义元素渲染。
 */
function MarkdownContent({
  input,
  options,
}: {
  input: string;
  options: RenderMarkdownOptions;
}) {
  const components = createMarkdownComponents(options);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {replaceSourceMarkers(input)}
    </ReactMarkdown>
  );
}

/**
 * 创建 Markdown 元素到项目 UI 样式的映射。
 */
function createMarkdownComponents(
  options: RenderMarkdownOptions,
): Components {
  return {
    p: ({ children }) => (
      <p className="my-0.5">
        {children}
        <ImplicitCitation children={children} options={options} />
      </p>
    ),
    h1: ({ children }) => (
      <Heading level={1} options={options}>
        {children}
      </Heading>
    ),
    h2: ({ children }) => (
      <Heading level={2} options={options}>
        {children}
      </Heading>
    ),
    h3: ({ children }) => (
      <Heading level={3} options={options}>
        {children}
      </Heading>
    ),
    h4: ({ children }) => (
      <Heading level={4} options={options}>
        {children}
      </Heading>
    ),
    ul: ({ children }) => <ul className="my-0.5 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-0.5 pl-5">{children}</ol>,
    li: ({ children }) => (
      <li className="my-0.5">
        {children}
        <ImplicitCitation children={children} options={options} />
      </li>
    ),
    a: ({ href, children }) => {
      const source = href?.startsWith("#source:")
        ? findCitationBySourceId(
            decodeURIComponent(href.slice("#source:".length)),
            options.citationSources,
          )
        : null;

      if (source) {
        return <CitationLink source={source} />;
      }

      return (
        <a
          className="md-link"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {children}
        </a>
      );
    },
    pre: ({ children }) => {
      const codeElement = Array.isArray(children) ? children[0] : children;
      if (isValidElement(codeElement)) {
        const props = codeElement.props as {
          className?: string;
          children?: ReactNode;
        };
        const language =
          /language-([\w+-]+)/.exec(props.className ?? "")?.[1] ?? null;
        const body = flattenReactText(props.children).replace(/\n$/, "");

          if (
            options.enableVisualizations &&
            isDocumentVisualLanguage(language)
          ) {
            return (
              <DocumentVisualBlock
                language={language}
                body={body}
                fallback={<CodeBlock lang={language} body={body} />}
              />
            );
          }

        return <CodeBlock lang={language} body={body} />;
      }

      return <pre className="md-code">{children}</pre>;
    },
    code: ({ className, children }) => {
      return (
        <code
          className={className ? `${className} md-inline-code` : "md-inline-code"}
        >
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div className="my-2 max-w-full overflow-x-auto rounded-md border border-[var(--line-soft)]">
        <table className="min-w-full border-collapse text-left text-[13px]">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-[var(--surface-muted)]">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="border-b border-[var(--line-soft)] px-3 py-2 font-bold text-[var(--ink)]">
        {children}
      </th>
    ),
    tr: ({ children }) => (
      <tr className="border-b border-[var(--line-soft)] last:border-b-0">
        {children}
      </tr>
    ),
    td: ({ children }) => (
      <td className="max-w-[320px] align-top px-3 py-2 text-[var(--ink-soft)]">
        {children}
      </td>
    ),
    hr: () => <hr className="md-hr" />,
  };
}

/**
 * 标题组件，统一字号并追加隐式引用入口。
 */
function Heading({
  level,
  children,
  options,
}: {
  level: 1 | 2 | 3 | 4;
  children: ReactNode;
  options: RenderMarkdownOptions;
}) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";

  return (
    <Tag
      className="my-1.5 leading-tight"
      style={{
        fontFamily: "var(--sans)",
        fontWeight: level <= 2 ? 700 : 600,
        fontSize: level === 1 ? 20 : level === 2 ? 17 : level === 3 ? 15 : 13,
        color: "var(--ink)",
        letterSpacing: "0",
        borderBottom: level === 1 ? "1px solid var(--line-soft)" : undefined,
        paddingBottom: level === 1 ? 6 : undefined,
        lineHeight: 1.2,
      }}
    >
      {children}
      <ImplicitCitation children={children} options={options} />
    </Tag>
  );
}

/**
 * 根据当前块文本自动追加最可能的搜索来源。
 */
function ImplicitCitation({
  children,
  options,
}: {
  children: ReactNode;
  options: RenderMarkdownOptions;
}) {
  if (hasSourceCitationChild(children)) return null;

  const citation = findBestCitation(
    flattenReactText(children),
    options.citationSources,
  );

  return citation ? <CitationLink source={citation} /> : null;
}

/**
 * 将模型显式来源标记转换成 react-markdown 可解析的普通链接。
 */
function replaceSourceMarkers(input: string): string {
  return input.replace(/\[\[source:([^\]\s]+)\]\]/g, (_match, sourceId) => {
    return `[↗](#source:${encodeURIComponent(sourceId)})`;
  });
}

/**
 * 判断 React 子树里是否已经包含显式来源链接。
 */
function hasSourceCitationChild(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasSourceCitationChild);
  if (!isValidElement(node)) return false;

  const props = node.props as { href?: unknown; children?: ReactNode };
  if (typeof props.href === "string" && props.href.startsWith("#source:")) {
    return true;
  }

  return hasSourceCitationChild(props.children);
}

/**
 * 抽取 React 子树中的纯文本，用于来源匹配。
 */
function flattenReactText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(flattenReactText).join(" ");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return flattenReactText(props.children);
  }

  return "";
}

/**
 * 为一段助手正文选择最可能支撑该事实的联网搜索来源。
 */
function findBestCitation(
  text: string,
  sources: MarkdownCitationSource[] | undefined,
): MarkdownCitationSource | null {
  if (!sources?.length) return null;

  const target = normalizeCitationText(text);
  const targetTokens = tokenizeForCitation(target);
  if (targetTokens.size < 2) return null;

  let best: { source: MarkdownCitationSource; score: number } | null = null;

  for (const source of sources) {
    const title = normalizeCitationText(source.title);
    const snippet = normalizeCitationText(source.snippet ?? "");

    if (hasStrongTextContainment(target, title)) {
      return source;
    }

    const titleScore = scoreTokenOverlap(
      targetTokens,
      tokenizeForCitation(title),
    );
    const snippetScore =
      scoreTokenOverlap(targetTokens, tokenizeForCitation(snippet)) * 0.6;
    const score = Math.max(titleScore, snippetScore);

    if (!best || score > best.score) {
      best = { source, score };
    }
  }

  return best && best.score >= 0.26 ? best.source : null;
}

/**
 * 根据模型输出的来源编号查找明确引用。
 */
function findCitationBySourceId(
  sourceId: string,
  sources: MarkdownCitationSource[] | undefined,
): MarkdownCitationSource | null {
  if (!sources?.length) return null;

  return sources.find((source) => source.sourceId === sourceId) ?? null;
}

/**
 * 渲染可悬浮查看、可点击跳转的来源图标。
 */
function CitationLink({ source }: { source: MarkdownCitationSource }) {
  return (
    <Tooltip
      title={
        <div className="max-w-[320px]">
          <div className="text-[12px] font-bold leading-snug">
            来源：{source.title}
          </div>
          <div className="mt-1 wrap-break-word text-[11px] opacity-80">
            {source.url}
          </div>
        </div>
      }
    >
      <a
        aria-label={`查看来源：${source.title}`}
        className="ml-1 inline-flex align-text-bottom text-[12px] text-[var(--primary)]"
        href={source.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        <LinkOutlined />
      </a>
    </Tooltip>
  );
}

/**
 * 清理 Markdown 和标点噪声，保留用于来源匹配的事实文本。
 */
function normalizeCitationText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_>#|[\](){}:：，。；？！“”‘’、\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 对中英文混合内容生成关键词集合，支持中文二元短语和英文单词匹配。
 */
function tokenizeForCitation(text: string): Set<string> {
  const tokens = new Set<string>();
  const latinWords = text.match(/[a-z0-9][a-z0-9.+#-]{2,}/g) ?? [];
  for (const word of latinWords) {
    if (!CITATION_STOP_WORDS.has(word)) tokens.add(word);
  }

  const cjkRuns = text.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length <= 4) {
      tokens.add(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index++) {
      tokens.add(run.slice(index, index + 2));
    }
  }

  return tokens;
}

/**
 * 计算正文和来源之间的关键词重合度。
 */
function scoreTokenOverlap(target: Set<string>, source: Set<string>): number {
  if (target.size === 0 || source.size === 0) return 0;

  let overlap = 0;
  for (const token of target) {
    if (source.has(token)) overlap++;
  }

  return overlap / Math.min(target.size, source.size);
}

/**
 * 对标题级强匹配直接归因，减少短标题被阈值误伤。
 */
function hasStrongTextContainment(target: string, sourceTitle: string): boolean {
  const compactTarget = target.replace(/\s+/g, "");
  const compactTitle = sourceTitle.replace(/\s+/g, "");

  return (
    compactTitle.length >= 6 &&
    (compactTarget.includes(compactTitle) ||
      compactTitle.includes(compactTarget))
  );
}

const CITATION_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "are",
  "was",
  "were",
  "has",
  "have",
  "you",
  "your",
]);

/**
 * 带复制按钮的代码块。
 */
function CodeBlock({ lang, body }: { lang: string | null; body: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = body;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
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
            color: "var(--ink-faint)",
            height: "auto",
            padding: "0 6px",
            fontFamily: "var(--sans)",
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

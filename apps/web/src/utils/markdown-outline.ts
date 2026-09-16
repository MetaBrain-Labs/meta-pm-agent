/**
 * Markdown 章节结构提取
 *
 * 从交付文档的 Markdown 正文中提取标题层级，供文档预览面板展示「章节结构」。
 *
 * Responsibilities:
 * - 按 ATX 标题（`#`…`####`）提取层级与标题文字
 * - 跳过代码块内的 `#`，避免把注释当成标题
 * - 去掉标题里的行内标记，输出可直接展示的纯文本
 *
 * Notes:
 * - 只做文本解析，不渲染、不请求；正文展示仍由 markdown.tsx 负责。
 * - 不解析 setext 标题（下划线式），交付文档统一使用 ATX。
 */

/** 章节标题。 */
export interface MarkdownOutlineItem {
  /** 稳定 key：序号 + 标题，重复标题之间也不会冲突。 */
  id: string;
  /** 标题层级，1 为最高。 */
  level: number;
  /** 去掉行内标记后的标题文字。 */
  text: string;
}

/** 支持解析的最大标题层级；#5 以下不再作为章节结构展示。 */
const MAX_LEVEL = 4;

/**
 * 从 Markdown 提取章节结构。
 *
 * 返回顺序即文档顺序；层级由 `#` 数量决定，缩进交给调用方按 level 处理。
 */
export function extractMarkdownOutline(
  markdown: string,
): MarkdownOutlineItem[] {
  const items: MarkdownOutlineItem[] = [];
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    // 围栏代码块：内部内容一律不作为标题。
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;

    const level = match[1]!.length;
    if (level > MAX_LEVEL) continue;

    const text = stripInlineMarkup(match[2]!);
    if (!text) continue;

    items.push({ id: `${items.length}-${text}`, level, text });
  }

  return items;
}

/** 去掉标题里的链接、强调与代码标记，保留可读文字。 */
function stripInlineMarkup(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

/**
 * 内容预览摘要：用章节数量与体量说明文档规模。
 *
 * 面板只做摘要，正文交给完整 Markdown 弹窗，避免预览区变成第二个阅读器。
 */
export function buildContentSummary(
  outline: MarkdownOutlineItem[],
  markdown: string,
): string {
  return `共 ${outline.length} 个章节 · 约 ${markdown.length.toLocaleString()} 字符；`;
}

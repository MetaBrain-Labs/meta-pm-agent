import type { ToolCallInfo } from "../types";
import type { MarkdownCitationSource } from "./markdown";

interface WebSearchResult {
  sourceId?: string;
  title?: string;
  url?: string;
  snippet?: string;
}

interface WebSearchPayload {
  results?: WebSearchResult[];
}

/**
 * 从联网搜索工具结果中提取可用于正文归因的来源列表。
 */
export function collectWebSearchCitationSources(
  toolCalls: ToolCallInfo[] | undefined,
): MarkdownCitationSource[] {
  if (!toolCalls?.length) return [];

  const sources: MarkdownCitationSource[] = [];
  const seenUrls = new Set<string>();

  for (const toolCall of toolCalls) {
    if (toolCall.name !== "web_search") continue;
    const payload = parseWebSearchPayload(toolCall.result);

    for (const result of payload?.results ?? []) {
      if (!result.url || seenUrls.has(result.url)) continue;
      seenUrls.add(result.url);
      sources.push({
        sourceId: result.sourceId ?? String(sources.length + 1),
        title: result.title?.trim() || result.url,
        url: result.url,
        snippet: result.snippet?.trim(),
      });
    }
  }

  return sources;
}

/**
 * 兼容实时流和历史消息中保存的字符串化工具结果。
 */
function parseWebSearchPayload(value: unknown): WebSearchPayload | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as WebSearchPayload;
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && value !== null) {
    return value as WebSearchPayload;
  }

  return null;
}

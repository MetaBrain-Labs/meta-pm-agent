/**
 * 联网搜索工具
 *
 * 为授权 Agent 提供 web_search 工具，优先使用 Tavily API，
 * 失败时自动回退到 DuckDuckGo 免费搜索。搜索结果以结构化 JSON 返回，
 * 包含来源编号、标题、URL 和摘要。
 *
 * Responsibilities:
 * - createWebSearchTool()：创建 LangChain tool 实例
 * - 优先使用 Tavily API（需 TAVILY_API_KEY），回退 DuckDuckGo
 * - 搜索失败时返回 results: [] 和 error 字段，不抛出异常
 * - 注入运行时日期到搜索结果中
 *
 * Notes:
 * - 搜索超时 8s，防止阻塞 SSE 流
 * - 网络/解析失败不终止流，保证用户体验连续性
 */

import { tool } from "langchain/tools";
import { z } from "zod";
import { getRuntimeDateContext } from "./runtime-context";

interface WebSearchResult {
  sourceId?: string;
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchResponse {
  results: WebSearchResult[];
  source?: string;
  warnings?: string[];
  error?: string;
}

const WEB_SEARCH_TIMEOUT_MS = 8_000;

/**
 * 创建联网搜索工具，供被授权的 Agent 查询外部事实和近期信息。
 */
export function createWebSearchTool() {
  const runtimeContext = getRuntimeDateContext();
  let nextCitationSourceId = 1;

  return tool(
    async ({ query, maxResults = 5 }) => {
      const searchResult = await searchWeb(query, maxResults);
      const results = addCitationSourceIds(
        searchResult.results,
        nextCitationSourceId,
      );
      nextCitationSourceId += results.length;

      return JSON.stringify(
        {
          query,
          searchedAt: runtimeContext.currentDateTime,
          currentDate: runtimeContext.currentDate,
          currentYear: runtimeContext.currentYear,
          ...searchResult,
          results,
        },
        null,
        2,
      );
    },
    {
      name: "web_search",
      description:
        `Search the public web for recent or external information. Current server date is ${runtimeContext.currentDate} (${runtimeContext.timeZone}). Use this date for latest/recent/current/today queries and do not infer the year from model memory.`,
      schema: z.object({
        query: z.string().trim().min(1).max(500).describe("Search query."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("Maximum number of search results to return."),
      }),
    },
  );
}

/**
 * 给搜索结果补充短来源编号，便于模型在正文中输出可渲染的引用标记。
 */
function addCitationSourceIds(
  results: WebSearchResult[],
  firstSourceId: number,
): WebSearchResult[] {
  return results.map((result, index) => ({
    sourceId: String(firstSourceId + index),
    ...result,
  }));
}

/**
 * 根据本地配置选择搜索后端，避免把具体供应商耦合进 Agent。
 */
async function searchWeb(
  query: string,
  maxResults: number,
): Promise<WebSearchResponse> {
  const warnings: string[] = [];

  const tavilyApiKey = process.env.TAVILY_API_KEY?.trim();

  if (tavilyApiKey) {
    try {
      return {
        results: await searchWithTavily(query, maxResults, tavilyApiKey),
        source: "tavily",
      };
    } catch (error) {
      warnings.push(`Tavily search unavailable: ${formatSearchError(error)}`);
    }
  }

  try {
    const fallback = await searchWithFreePublicIndexes(query, maxResults);
    return {
      ...fallback,
      warnings:
        warnings.length > 0
          ? [...warnings, ...(fallback.warnings ?? [])]
          : fallback.warnings,
    };
  } catch (error) {
    return {
      results: [],
      warnings: warnings.length > 0 ? warnings : undefined,
      error: `Web search unavailable: ${formatSearchError(error)}`,
    };
  }
}

/**
 * 通过 Tavily Search API 获取面向 Agent 的实时网页搜索结果。
 */
async function searchWithTavily(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      chunks_per_source: 3,
      max_results: maxResults,
      include_answer: false,
      include_images: false,
      include_raw_content: false,
    }),
    signal: createTimeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(`Tavily web search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;
  };

  return (payload.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, maxResults)
    .map((item) => ({
      title: item.title!,
      url: item.url!,
      snippet: item.content ?? "",
    }));
}

/**
 * 使用免费公开索引作为无密钥搜索兜底。
 */
async function searchWithFreePublicIndexes(
  query: string,
  maxResults: number,
): Promise<WebSearchResponse> {
  const [hackerNews, openAlex] = await Promise.allSettled([
    searchHackerNews(query, maxResults),
    searchOpenAlex(query, maxResults),
  ]);

  const warnings: string[] = [];
  const results = [
    ...collectPublicIndexResults("hacker-news", hackerNews, warnings),
    ...collectPublicIndexResults("openalex", openAlex, warnings),
  ];

  return {
    results: dedupeResults(results).slice(0, maxResults),
    source: "free-public-indexes",
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * 搜索 Hacker News Algolia 索引，适合技术新闻和工程资料。
 */
async function searchHackerNews(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("hitsPerPage", String(maxResults));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal: createTimeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(`Hacker News search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    hits?: Array<{
      title?: string;
      story_title?: string;
      url?: string;
      story_url?: string;
      author?: string;
      created_at?: string;
    }>;
  };

  return (payload.hits ?? [])
    .map((item) => ({
      title: stripHtml(item.title ?? item.story_title ?? ""),
      url: item.url ?? item.story_url ?? "",
      snippet: [
        item.author ? `author: ${item.author}` : "",
        item.created_at ? `created: ${item.created_at}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    }))
    .filter((item) => item.title && item.url);
}

/**
 * 搜索 OpenAlex 公开学术索引，适合论文、报告和研究背景。
 */
async function searchOpenAlex(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(maxResults));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal: createTimeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(`OpenAlex search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      title?: string;
      display_name?: string;
      doi?: string;
      id?: string;
      publication_year?: number;
      primary_location?: {
        landing_page_url?: string;
      };
    }>;
  };

  return (payload.results ?? [])
    .map((item) => ({
      title: stripHtml(item.title ?? item.display_name ?? ""),
      url: item.primary_location?.landing_page_url ?? item.doi ?? item.id ?? "",
      snippet: item.publication_year
        ? `publication year: ${item.publication_year}`
        : "",
    }))
    .filter((item) => item.title && item.url);
}

/**
 * 收集公开索引结果并记录单个索引的失败原因。
 */
function collectPublicIndexResults(
  source: string,
  result: PromiseSettledResult<WebSearchResult[]>,
  warnings: string[],
): WebSearchResult[] {
  if (result.status === "fulfilled") return result.value;

  warnings.push(`${source} unavailable: ${formatSearchError(result.reason)}`);
  return [];
}

/**
 * 按 URL 去重，避免多个公开索引返回同一资料。
 */
function dedupeResults(results: WebSearchResult[]): WebSearchResult[] {
  const seenUrls = new Set<string>();

  return results.filter((result) => {
    const key = result.url.trim().toLowerCase();
    if (!key || seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });
}

/**
 * 清理搜索结果中的 HTML 高亮标签。
 */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 为搜索请求设置超时，避免工具调用长时间占用 Agent 流。
 */
function createTimeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || !("timeout" in AbortSignal)) {
    return undefined;
  }

  return (
    AbortSignal as typeof AbortSignal & {
      timeout(milliseconds: number): AbortSignal;
    }
  ).timeout(WEB_SEARCH_TIMEOUT_MS);
}

/**
 * 将网络错误整理成可读文本，作为工具结果交给模型处理。
 */
function formatSearchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause =
    "cause" in error && error.cause
      ? `; cause: ${formatSearchError(error.cause)}`
      : "";

  return `${error.name}: ${error.message}${cause}`;
}

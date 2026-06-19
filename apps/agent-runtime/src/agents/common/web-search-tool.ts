import { tool } from "langchain/tools";
import { z } from "zod";

interface WebSearchResult {
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
  return tool(
    async ({ query, maxResults = 5 }) => {
      const searchResult = await searchWeb(query, maxResults);

      return JSON.stringify(
        {
          query,
          ...searchResult,
        },
        null,
        2,
      );
    },
    {
      name: "web_search",
      description:
        "Search the public web for recent or external information. Use it only when the answer needs facts that may not be in the conversation or model memory.",
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
 * 根据本地配置选择搜索后端，避免把具体供应商耦合进 Agent。
 */
async function searchWeb(
  query: string,
  maxResults: number,
): Promise<WebSearchResponse> {
  const warnings: string[] = [];

  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      return {
        results: await searchWithBrave(query, maxResults),
        source: "brave",
      };
    } catch (error) {
      warnings.push(`Brave search unavailable: ${formatSearchError(error)}`);
    }
  }

  try {
    return {
      results: await searchWithDuckDuckGo(query, maxResults),
      source: "duckduckgo",
      warnings: warnings.length > 0 ? warnings : undefined,
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
 * 通过 Brave Search API 获取结构化网页搜索结果。
 */
async function searchWithBrave(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
    },
    signal: createTimeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(`Brave web search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  return (payload.web?.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, maxResults)
    .map((item) => ({
      title: item.title!,
      url: item.url!,
      snippet: item.description ?? "",
    }));
}

/**
 * 使用 DuckDuckGo 公开 Instant Answer 接口作为无密钥开发环境降级方案。
 */
async function searchWithDuckDuckGo(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal: createTimeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(
      `DuckDuckGo web search failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: DuckDuckGoTopic[];
  };

  const results: WebSearchResult[] = [];
  if (payload.AbstractText && payload.AbstractURL) {
    results.push({
      title: payload.Heading || query,
      url: payload.AbstractURL,
      snippet: payload.AbstractText,
    });
  }

  for (const topic of flattenDuckDuckGoTopics(payload.RelatedTopics ?? [])) {
    if (results.length >= maxResults) break;
    if (!topic.FirstURL || !topic.Text) continue;

    results.push({
      title: topic.Text.split(" - ")[0] || topic.FirstURL,
      url: topic.FirstURL,
      snippet: topic.Text,
    });
  }

  return results.slice(0, maxResults);
}

type DuckDuckGoTopic =
  | {
      FirstURL?: string;
      Text?: string;
    }
  | {
      Topics?: DuckDuckGoTopic[];
    };

/**
 * 展开 DuckDuckGo 分组结果，保持工具输出结构稳定。
 */
function flattenDuckDuckGoTopics(
  topics: DuckDuckGoTopic[],
): Array<{ FirstURL?: string; Text?: string }> {
  const flattened: Array<{ FirstURL?: string; Text?: string }> = [];

  for (const topic of topics) {
    if ("Topics" in topic && Array.isArray(topic.Topics)) {
      flattened.push(...flattenDuckDuckGoTopics(topic.Topics));
      continue;
    }

    if (isDuckDuckGoResultTopic(topic)) {
      flattened.push(topic);
    }
  }

  return flattened;
}

/**
 * 判断 DuckDuckGo 条目是否为可展示的搜索结果。
 */
function isDuckDuckGoResultTopic(
  topic: DuckDuckGoTopic,
): topic is { FirstURL?: string; Text?: string } {
  return "FirstURL" in topic || "Text" in topic;
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

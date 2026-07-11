/**
 * Web Search 工具共享提示词
 *
 * 提供 web_search 工具的统一使用规范，供 Conversation Agent 和 Executor Agent
 * 在启用联网搜索能力时注入到各自的 system prompt 中。
 *
 * Responsibilities:
 * - 定义 WEB_SEARCH_USAGE_PROMPT 常量：工具使用时机、查询构造、引用标记等规范
 * - 提供 buildRuntimeContextPrompt() 函数：将服务器日期注入提示上下文
 * - 确保所有使用 web_search 的 Agent 遵循统一的行为约定
 *
 * Notes:
 * - WEB_SEARCH_USAGE_PROMPT 引用了"runtime date above"，调用方需在之前注入 runtime context
 * - 调用方负责判断当前 Agent 是否实际启用了 web_search 工具后再注入
 */

import {
  getRuntimeDateContext,
  type RuntimeDateContext,
} from "./runtime-context";

/**
 * web_search 工具的统一使用规范。
 *
 * 调用方应在注入此提示词前先注入 runtime context（当前服务器日期），
 * 以便其中的相对时间规则有可靠的日期基准。
 */
export const WEB_SEARCH_USAGE_PROMPT = `## Web search tool

- You may call \`web_search\` only when the current turn needs external facts, recent information, source verification, market references, or other information not present in the conversation.
- Do not call \`web_search\` for routine routing, simple clarification, or form generation when the user-provided context is sufficient.
- When the user asks for latest, recent, current, today, this month, this year, or similar relative-time information, interpret it using the runtime date above instead of model memory.
- When building a \`web_search\` query for relative-time requests, include the current year/date or a concrete recent period from the runtime context when useful. For example, a request for recent GitHub hotspots should search for 2026 or June 2026 GitHub trending repositories instead of older years.
- If search results look stale or conflict with the runtime date, refine the query once before answering, or explicitly say the latest information could not be verified.
- When a bullet, headline, or factual claim is supported by a search result, append a compact citation marker using that result's \`sourceId\`, for example \`[[source:1]]\`. Do not invent source ids and do not show raw URLs in normal prose unless the user asks for them.
- When search results influence your answer, summarize the useful findings in the user's language and keep the project-management workflow intact.`;

/**
 * 构造 Runtime context 提示词片段，将服务器当前日期注入模型上下文。
 *
 * 所有相对时间的判断应以此日期为基准，而非模型训练数据中的年份。
 */
export function buildRuntimeContextPrompt(
  context: RuntimeDateContext = getRuntimeDateContext(),
): string {
  return `## Runtime context

- Current server date: ${context.currentDate} (${context.timeZone}).
- Current server year: ${context.currentYear}.
- Treat relative-time phrases as relative to this date, not to the model's training data.`;
}

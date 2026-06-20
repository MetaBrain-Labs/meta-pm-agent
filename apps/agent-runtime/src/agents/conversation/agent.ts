import { createDeepAgent } from "deepagents";
import type { AgentRuntimeTool } from "@repo/shared";
import { createToolsForAgent } from "../common/tool-access";
import { createChatModel } from "../common/model";
import {
  getRuntimeDateContext,
  type RuntimeDateContext,
} from "../common/runtime-context";
import { DISCOVERY_PROMPT } from "./prompt";

export interface ConversationAgentOptions {
  enabledTools?: AgentRuntimeTool[];
}

/**
 * 创建 Conversation Agent，负责和用户交互、生成问题表单并整理 user_input。
 */
export function createConversationAgent(options: ConversationAgentOptions = {}) {
  const model = createChatModel();
  const tools = createToolsForAgent("conversation", options.enabledTools);
  const runtimeContext = getRuntimeDateContext();

  return createDeepAgent({
    model: model as any,
    systemPrompt: buildConversationPrompt({
      runtimeContext,
      webSearchEnabled: tools.length > 0,
    }),
    tools,
    name: "conversation-agent",
    skills: [],
  });
}

interface ConversationPromptOptions {
  runtimeContext: RuntimeDateContext;
  webSearchEnabled: boolean;
}

/**
 * 根据本轮工具能力生成 Conversation Agent 系统提示。
 */
function buildConversationPrompt({
  runtimeContext,
  webSearchEnabled,
}: ConversationPromptOptions): string {
  const runtimePrompt = buildRuntimeContextPrompt(runtimeContext);

  if (!webSearchEnabled) {
    return `${DISCOVERY_PROMPT}

${runtimePrompt}`;
  }

  return `${DISCOVERY_PROMPT}

${runtimePrompt}

## Web search tool

- You may call \`web_search\` only when the current turn needs external facts, recent information, source verification, market references, or other information not present in the conversation.
- Do not call \`web_search\` for routine routing, simple clarification, or form generation when the user-provided context is sufficient.
- When the user asks for latest, recent, current, today, this month, this year, or similar relative-time information, interpret it using the runtime date above instead of model memory.
- When building a \`web_search\` query for relative-time requests, include the current year/date or a concrete recent period from the runtime context when useful. For example, a request for recent GitHub hotspots should search for 2026 or June 2026 GitHub trending repositories instead of older years.
- If search results look stale or conflict with the runtime date, refine the query once before answering, or explicitly say the latest information could not be verified.
- When search results influence your answer, summarize the useful findings in the user's language and keep the project-management workflow intact.`;
}

/**
 * 将服务器当前日期写入系统提示，作为所有相对时间判断的业务基准。
 */
function buildRuntimeContextPrompt(context: RuntimeDateContext): string {
  return `## Runtime context

- Current server date: ${context.currentDate} (${context.timeZone}).
- Current server year: ${context.currentYear}.
- Treat relative-time phrases as relative to this date, not to the model's training data.`;
}

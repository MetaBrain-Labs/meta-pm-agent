import { createDeepAgent } from "deepagents";
import type { AgentRuntimeTool } from "@repo/shared";
import { createToolsForAgent } from "../common/tool-access";
import { createChatModel } from "../common/model";
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

  return createDeepAgent({
    model: model as any,
    systemPrompt: buildConversationPrompt(tools.length > 0),
    tools,
    name: "conversation-agent",
    skills: [],
  });
}

/**
 * 根据本轮工具能力生成 Conversation Agent 系统提示。
 */
function buildConversationPrompt(webSearchEnabled: boolean): string {
  if (!webSearchEnabled) return DISCOVERY_PROMPT;

  return `${DISCOVERY_PROMPT}

## Web search tool

- You may call \`web_search\` only when the current turn needs external facts, recent information, source verification, market references, or other information not present in the conversation.
- Do not call \`web_search\` for routine routing, simple clarification, or form generation when the user-provided context is sufficient.
- When search results influence your answer, summarize the useful findings in the user's language and keep the project-management workflow intact.`;
}

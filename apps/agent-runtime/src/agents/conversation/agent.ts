import { createDeepAgent } from "deepagents";
import { createChatModel } from "../common/model";
import { DISCOVERY_PROMPT } from "./prompt";

/**
 * 创建 Conversation Agent，负责和用户交互、生成问题表单并整理 user_input。
 */
export function createConversationAgent() {
  const model = createChatModel();
  return createDeepAgent({
    model: model as any,
    systemPrompt: DISCOVERY_PROMPT,
    tools: [],
    name: "conversation-agent",
    skills: [],
  });
}

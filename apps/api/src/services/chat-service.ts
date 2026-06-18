import type { ChatMessage } from "@repo/shared";
import {
  createConversationWithInitialRequestForm,
  listActiveConversations,
} from "../repositories/chat-repository";
import {
  listConversationMessages,
  persistAssistantMessage,
  persistConversationMessages,
} from "../repositories/message-repository";
import { persistRequestAnalysisItems } from "../repositories/request-form-repository";
import { parseRequestAnalysisPayload } from "../utils/request-analysis";
import { parseUserInputPayload } from "../utils/user-input";

const DEFAULT_CHAT_TITLE = "New Chat";

/**
 * 单个 Agent 在一轮对话中的输出，用于分 Agent 持久化消息和推理过程。
 */
export interface AgentConversationOutput {
  type: string;
  content: string;
  reasoningContent?: string;
}

/**
 * 获取指定工作区内的活跃会话列表。
 */
export function listChats(workspaceId: string) {
  return listActiveConversations(workspaceId);
}

/**
 * 获取指定会话的所有历史消息。
 */
export function listMessages(conversationId: string) {
  return listConversationMessages(conversationId);
}

/**
 * 在指定工作区中创建新会话，同时初始化一条请求表单记录。
 */
export async function createChat(
  workspaceId: string,
  title = DEFAULT_CHAT_TITLE,
) {
  const { conversation, requestForm } =
    await createConversationWithInitialRequestForm(workspaceId, title);

  return {
    chat: conversation,
    requestForm,
  };
}

/**
 * 在 Agent 开始处理前，持久化用户发送的消息列表。
 */
export async function persistConversationStart(
  conversationId: string | undefined,
  messages: ChatMessage[],
): Promise<void> {
  if (!conversationId) return;

  // 只持久化用户消息，助手回复由 persistConversationResult 统一写入。
  await persistConversationMessages(
    conversationId,
    messages.filter((message) => message.role === "user"),
  );
}

/**
 * 在 Agent 完成一轮处理后，按 Agent 类型分别持久化回复、推理和结构化结果。
 */
export async function persistConversationResult({
  conversationId,
  requestFormId,
  agentOutputs,
}: {
  conversationId?: string;
  requestFormId?: string;
  agentOutputs: AgentConversationOutput[];
}): Promise<void> {
  if (!conversationId || agentOutputs.length === 0) return;

  const conversationOutput = agentOutputs.find(
    (output) => output.type === "conversation",
  );
  const requestOutput = agentOutputs.find((output) => output.type === "request");
  const items = conversationOutput
    ? parseUserInputPayload(conversationOutput.content)
    : null;
  const requestAnalysis = requestOutput
    ? parseRequestAnalysisPayload(requestOutput.content)
    : null;

  // 每个 Agent 单独落库，message.type 用于前端恢复正确的展示位置。
  for (const output of agentOutputs) {
    if (
      output.content.trim().length === 0 &&
      !output.reasoningContent?.trim()
    ) {
      continue;
    }

    await persistAssistantMessage({
      conversationId,
      content: output.content,
      userInput: output.type === "conversation" ? items : null,
      reasoningContent: output.reasoningContent,
      type: output.type,
    });
  }

  await persistRequestAnalysisItems(requestFormId, requestAnalysis);
}

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

  // 只持久化用户消息，助手回复由 persistConversationResult 统一写入
  await persistConversationMessages(
    conversationId,
    messages.filter((message) => message.role === "user"),
  );
}

/**
 * 在 Agent 完成一轮处理后，解析并持久化助手回复、推理内容及需求分析结果。
 */
export async function persistConversationResult({
  conversationId,
  requestFormId,
  assistantText,
  reasoningContent,
}: {
  conversationId?: string;
  requestFormId?: string;
  assistantText: string;
  reasoningContent?: string;
}): Promise<void> {
  if (!conversationId || assistantText.trim().length === 0) return;

  // 同一条 assistant 消息里会同时携带 user-input 与 request-analysis，
  // 这里分别解析并写入对应的消息表字段与请求表单条目。
  const items = parseUserInputPayload(assistantText);
  const requestAnalysis = parseRequestAnalysisPayload(assistantText);
  await persistAssistantMessage(
    conversationId,
    assistantText,
    items,
    reasoningContent,
  );
  await persistRequestAnalysisItems(requestFormId, requestAnalysis);
}

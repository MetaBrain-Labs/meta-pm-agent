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

const DEFAULT_CHAT_TITLE = "\u65b0\u5bf9\u8bdd";

export function listChats(workspaceId: string) {
  return listActiveConversations(workspaceId);
}

export function listMessages(conversationId: string) {
  return listConversationMessages(conversationId);
}

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

export async function persistConversationStart(
  conversationId: string | undefined,
  messages: ChatMessage[],
): Promise<void> {
  if (!conversationId) return;

  await persistConversationMessages(
    conversationId,
    messages.filter((message) => message.role === "user"),
  );
}

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

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
  assistantText,
  reasoningContent,
}: {
  conversationId?: string;
  assistantText: string;
  reasoningContent?: string;
}): Promise<void> {
  if (!conversationId || assistantText.trim().length === 0) return;

  const items = parseUserInputPayload(assistantText);
  await persistAssistantMessage(
    conversationId,
    assistantText,
    items,
    reasoningContent,
  );
}

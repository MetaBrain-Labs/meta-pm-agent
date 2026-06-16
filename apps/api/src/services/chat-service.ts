import type { ChatMessage } from "@repo/shared";
import {
  createChatWithInitialRequestForm,
  listActiveChats,
} from "../repositories/chat-repository";
import {
  persistAssistantMessage,
  persistChatMessages,
} from "../repositories/message-repository";
import { replaceRequestFormItems } from "../repositories/request-form-repository";
import { parseUserInputPayload } from "../utils/user-input";

const DEFAULT_CHAT_TITLE = "\u65b0\u5bf9\u8bdd";

export function listChats() {
  return listActiveChats();
}

export function createChat(title = DEFAULT_CHAT_TITLE) {
  return createChatWithInitialRequestForm(title);
}

export async function persistConversationStart(
  chatId: string | undefined,
  messages: ChatMessage[],
): Promise<void> {
  if (!chatId) return;

  await persistChatMessages(chatId, messages);
}

export async function persistConversationResult({
  chatId,
  requestFormId,
  assistantText,
}: {
  chatId?: string;
  requestFormId?: string;
  assistantText: string;
}): Promise<void> {
  if (chatId && assistantText.trim().length > 0) {
    await persistAssistantMessage(chatId, assistantText);
  }

  if (!requestFormId) return;

  const items = parseUserInputPayload(assistantText);
  if (!items || items.length === 0) return;

  try {
    await replaceRequestFormItems(requestFormId, items);
  } catch (error) {
    console.error("[chat] Failed to persist user_input:", error);
  }
}

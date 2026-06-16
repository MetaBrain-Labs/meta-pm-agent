import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type { ChatMessage } from "@repo/shared";
import type { UserInputRecord } from "../utils/user-input";

export async function persistConversationMessages(
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const message of messages) {
      const meta = JSON.stringify({
        sessionId: message.sessionId,
        timestamp: message.timestamp,
        ...(message.reasoningContent
          ? { reasoningContent: message.reasoningContent }
          : {}),
      });

      await tx.$executeRaw`
        INSERT INTO "message" (
          "id",
          "conversation_id",
          "role",
          "content",
          "meta",
          "user_input",
          "type"
        )
        VALUES (
          ${message.id},
          ${conversationId},
          ${message.role},
          ${message.content},
          ${meta}::jsonb,
          NULL,
          NULL
        )
        ON CONFLICT ("id") DO UPDATE
        SET
          "content" = EXCLUDED."content",
          "meta" = EXCLUDED."meta",
          "user_input" = EXCLUDED."user_input",
          "type" = EXCLUDED."type"
      `;
    }

    await tx.$executeRaw`
      UPDATE "conversation"
      SET "last_message_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${conversationId}
    `;
  });
}

export async function persistAssistantMessage(
  conversationId: string,
  content: string,
  userInput: UserInputRecord[] | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "message" (
        "id",
        "conversation_id",
        "role",
        "content",
        "meta",
        "user_input",
        "type"
      )
      VALUES (
        ${randomUUID()},
        ${conversationId},
        'assistant',
        ${content},
        ${JSON.stringify({ source: "conversation-agent" })}::jsonb,
        ${userInput ? JSON.stringify({ user_input: userInput }) : null}::jsonb,
        'conversation'
      )
    `;

    await tx.$executeRaw`
      UPDATE "conversation"
      SET "last_message_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${conversationId}
    `;
  });
}

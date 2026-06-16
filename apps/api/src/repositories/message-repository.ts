import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type { ChatMessage } from "@repo/shared";

export async function persistChatMessages(
  chatId: string,
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
        INSERT INTO "message" ("id", "chat_id", "role", "content", "meta")
        VALUES (
          ${message.id},
          ${chatId},
          ${message.role},
          ${message.content},
          ${meta}::json
        )
        ON CONFLICT ("id") DO UPDATE
        SET
          "content" = EXCLUDED."content",
          "meta" = EXCLUDED."meta"
      `;
    }

    await tx.$executeRaw`
      UPDATE "chat"
      SET "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${chatId}
    `;
  });
}

export async function persistAssistantMessage(
  chatId: string,
  content: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "message" ("id", "chat_id", "role", "content", "meta")
      VALUES (
        ${randomUUID()},
        ${chatId},
        'assistant',
        ${content},
        ${JSON.stringify({ source: "conversation-agent" })}::json
      )
    `;

    await tx.$executeRaw`
      UPDATE "chat"
      SET "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${chatId}
    `;
  });
}

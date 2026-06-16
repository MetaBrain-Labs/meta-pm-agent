import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type { ChatMessage } from "@repo/shared";
import {
  parseUserInputPayload,
  type UserInputRecord,
} from "../utils/user-input";

interface MessageRow {
  id: string;
  role: string;
  content: string;
  meta: unknown;
  user_input: unknown;
  created_at: Date | null;
}

export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  reasoningContent?: string;
  userInput?: UserInputRecord[] | null;
}

export async function listConversationMessages(
  conversationId: string,
): Promise<MessageDto[]> {
  const rows = await prisma.$queryRaw<MessageRow[]>`
    SELECT
      "id",
      "role",
      "content",
      "meta",
      "user_input",
      "created_at"
    FROM "message"
    WHERE "conversation_id" = ${conversationId}
    ORDER BY "created_at" ASC
  `;

  return rows.map(mapMessageRow);
}

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

function mapMessageRow(row: MessageRow): MessageDto {
  const meta = parseRecord(row.meta);
  const userInput = parseRecord(row.user_input);
  const inlineUserInput = parseUserInputPayload(row.content);
  const cleanedContent = removeTaggedBlock(
    row.content,
    "<user-input",
    "</user-input>",
  );
  const timestamp =
    typeof meta?.timestamp === "string"
      ? meta.timestamp
      : (row.created_at ?? new Date()).toISOString();

  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: cleanedContent,
    timestamp,
    ...(typeof meta?.reasoningContent === "string"
      ? { reasoningContent: meta.reasoningContent }
      : {}),
    userInput: Array.isArray(userInput?.user_input)
      ? (userInput.user_input as UserInputRecord[])
      : inlineUserInput,
  };
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

export async function persistAssistantMessage(
  conversationId: string,
  content: string,
  userInput: UserInputRecord[] | null,
  reasoningContent?: string,
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
        ${JSON.stringify({
          source: "conversation-agent",
          ...(reasoningContent ? { reasoningContent } : {}),
        })}::jsonb,
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

function removeTaggedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) return content;

  const endIndex = content.indexOf(endMarker, startIndex);
  if (endIndex === -1) return content;

  const blockEnd = endIndex + endMarker.length;
  return `${content.slice(0, startIndex)}${content.slice(blockEnd)}`.trim();
}

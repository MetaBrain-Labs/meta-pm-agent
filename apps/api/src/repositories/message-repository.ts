import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { type ChatMessage, type RequestAnalysis } from "@repo/shared";
import {
  parseUserInputPayload,
  type UserInputRecord,
} from "../utils/user-input";
import { parseRequestAnalysisPayload } from "../utils/request-analysis";

/**
 * 数据库 message 表原始行结构。
 */
interface MessageRow {
  id: string;
  role: string;
  content: string;
  meta: unknown;
  user_input: unknown;
  created_at: Date | null;
}

/**
 * 消息的数据传输对象，包含用户输入和需求分析的结构化数据。
 */
export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  reasoningContent?: string;
  userInput?: UserInputRecord[] | null;
  requestAnalysis?: RequestAnalysis | null;
}

/**
 * 查询指定会话的所有历史消息，按创建时间升序排列。
 */
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

/**
 * 批量持久化会话消息，使用 UPSERT 逻辑（存在则更新内容和元数据）。
 * 仅持久化用户消息，助手回复由 persistAssistantMessage 单独处理。
 */
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

/**
 * 将数据库行映射为消息 DTO，处理旧消息兼容和正文清洗。
 */
function mapMessageRow(row: MessageRow): MessageDto {
  const meta = parseRecord(row.meta);
  const userInput = parseRecord(row.user_input);

  // 旧消息可能只把 tagged block 存在正文里，因此读取历史消息时需要从正文回填结构化字段。
  const inlineUserInput = parseUserInputPayload(row.content);
  const inlineRequestAnalysis = parseRequestAnalysisPayload(row.content);

  // 正文返回给前端展示时去掉结构化 block，避免 JSON 原文和卡片重复显示。
  const cleanedContent = removeTaggedBlock(
    removeTaggedBlock(row.content, "<user-input", "</user-input>"),
    "<request-analysis",
    "</request-analysis>",
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
    requestAnalysis: inlineRequestAnalysis,
  };
}

/**
 * 安全地将 unknown 类型的 JSON 字段解析为对象，非对象类型返回 null。
 */
function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

/**
 * 持久化助手回复消息，同时写入推理内容和用户输入结构化数据。
 */
export async function persistAssistantMessage(
  conversationId: string,
  content: string,
  userInput: UserInputRecord[] | null,
  reasoningContent?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // TODO 目前type均为：conversation，后续需要进行更改
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

/**
 * 从消息正文中移除指定 tagged block，避免结构化 JSON 原文在正文中重复展示。
 */
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

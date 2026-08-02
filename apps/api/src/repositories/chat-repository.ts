import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

const DEFAULT_CHAT_TITLE = "New Chat";
const LOCALIZED_DEFAULT_CHAT_TITLE = "新对话";
const LOCAL_USER_ID = "local";

/**
 * 数据库 conversation 表原始行结构。
 */
interface ConversationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  last_message_at: Date | null;
  created_at: Date;
}

/**
 * 数据库 request_form 表原始行结构。
 */
interface RequestFormRow {
  id: string;
  chat_id: string;
  version: number;
  status: string;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 带关联 request_form_id 的会话列表查询结果行。
 */
interface ConversationListRow extends ConversationRow {
  request_form_id: string | null;
  message_count: number;
}

/**
 * 会话关联工作区信息的查询结果行。
 */
interface ConversationWorkspaceRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  local_path: string | null;
}

/**
 * 会话的数据传输对象（camelCase 字段命名）。
 */
export interface ConversationDto {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  type: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 会话列表项 DTO，额外包含关联的请求表单 ID。
 */
export interface ConversationListItemDto extends ConversationDto {
  requestFormId?: string;
  messageCount: number;
}

/**
 * 请求表单的数据传输对象。
 */
export interface RequestFormDto {
  id: string;
  chatId: string;
  version: number;
  status: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 会话关联工作区的数据传输对象，供产品上下文读取服务定位工作区路径。
 */
export interface ConversationWorkspaceDto {
  conversationId: string;
  workspaceId: string;
  workspaceName: string;
  localPath: string | null;
}

/**
 * 查询 当前 workspace + user 下所有的 active conversation，并且附带最新 request_form 记录
 */
export async function listActiveConversations(
  workspaceId: string,
): Promise<ConversationListItemDto[]> {
  const rows = await prisma.$queryRaw<ConversationListRow[]>`
    SELECT
      c."id",
      c."workspace_id",
      c."user_id",
      c."title",
      c."type",
      c."status",
      c."last_message_at",
      c."created_at",
      rf."id" AS "request_form_id",
      mc."message_count"
    FROM "conversation" c
    LEFT JOIN LATERAL (
      SELECT "id"
      FROM "request_form"
      WHERE "chat_id" = c."id"
      ORDER BY "version" DESC, "created_at" DESC
      LIMIT 1
    ) rf ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS "message_count"
      FROM "message"
      WHERE "conversation_id" = c."id"
    ) mc ON true
    WHERE c."status" = 'active'
      AND c."workspace_id" = ${workspaceId}
      AND c."user_id" = ${LOCAL_USER_ID}
    ORDER BY COALESCE(c."last_message_at", c."created_at") DESC
  `;

  return rows.map((row) => ({
    ...mapConversationRow(row),
    requestFormId: row.request_form_id ?? undefined,
    messageCount: row.message_count,
  }));
}

/**
 * 在指定工作区中创建新会话，同时创建一条请求表单记录。
 * 事务内确保本地用户存在（不存在时自动创建）。
 */
export async function createConversationWithInitialRequestForm(
  workspaceId: string,
  title: string,
): Promise<{ conversation: ConversationDto; requestForm: RequestFormDto }> {
  const { conversation, requestForm } = await prisma.$transaction(
    async (tx) => {
      // 确保本地用户记录存在
      await tx.$executeRaw`
      INSERT INTO "user" ("id", "username")
      VALUES (${LOCAL_USER_ID}, 'Local User')
      ON CONFLICT ("id") DO NOTHING
    `;

      // 创建会话记录
      const conversations = await tx.$queryRaw<ConversationRow[]>`
      INSERT INTO "conversation" (
        "id",
        "workspace_id",
        "user_id",
        "title",
        "type",
        "status"
      )
      VALUES (
        ${randomUUID()},
        ${workspaceId},
        ${LOCAL_USER_ID},
        ${title},
        'chat',
        'active'
      )
      RETURNING
        "id",
        "workspace_id",
        "user_id",
        "title",
        "type",
        "status",
        "last_message_at",
        "created_at"
    `;
      const conversation = conversations[0];
      if (!conversation) {
        throw new Error("Failed to create conversation.");
      }

      // 创建初始请求表单
      const requestForms = await tx.$queryRaw<RequestFormRow[]>`
      INSERT INTO "request_form" ("id", "chat_id", "version", "status")
      VALUES (${randomUUID()}, ${conversation.id}, 1, 'active')
      RETURNING "id", "chat_id", "version", "status", "summary", "created_at", "updated_at"
    `;
      const requestForm = requestForms[0];
      if (!requestForm) {
        throw new Error("Failed to create request form.");
      }

      return { conversation, requestForm };
    },
  );

  return {
    conversation: mapConversationRow(conversation),
    requestForm: mapRequestFormRow(requestForm),
  };
}

/**
 * 通过会话 ID 反查关联的工作区信息（名称和本地路径）。
 * 供产品上下文读取服务定位工作区概述文档。
 */
export async function getConversationWorkspace(
  conversationId: string,
): Promise<ConversationWorkspaceDto | null> {
  // 通过会话反查工作区路径，供产品上下文读取服务定位概述性文档。
  const rows = await prisma.$queryRaw<ConversationWorkspaceRow[]>`
    SELECT
      c."id",
      c."workspace_id",
      w."name" AS "workspace_name",
      w."local_path"
    FROM "conversation" c
    JOIN "workspace" w ON w."id" = c."workspace_id"
    WHERE c."id" = ${conversationId}
      AND c."user_id" = ${LOCAL_USER_ID}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    conversationId: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    localPath: row.local_path,
  };
}

/**
 * 按 ID 读取本地用户拥有的会话，供跨业务流程恢复既有专用对话。
 */
export async function getConversationById(
  conversationId: string,
): Promise<ConversationDto | null> {
  const rows = await prisma.$queryRaw<ConversationRow[]>`
    SELECT
      "id", "workspace_id", "user_id", "title", "type", "status",
      "last_message_at", "created_at"
    FROM "conversation"
    WHERE "id" = ${conversationId}
      AND "user_id" = ${LOCAL_USER_ID}
    LIMIT 1
  `;
  return rows[0] ? mapConversationRow(rows[0]) : null;
}

/**
 * 首轮用户消息完成后，仅在会话仍是默认标题时写入基于意图生成的标题。
 */
export async function updateFirstTurnConversationTitle(
  conversationId: string,
  title: string,
): Promise<ConversationDto | null> {
  const rows = await prisma.$queryRaw<ConversationRow[]>`
    UPDATE "conversation" c
    SET "title" = ${title}
    WHERE c."id" = ${conversationId}
      AND c."user_id" = ${LOCAL_USER_ID}
      AND (
        c."title" IS NULL
        OR btrim(c."title") = ''
        OR c."title" IN (${DEFAULT_CHAT_TITLE}, ${LOCALIZED_DEFAULT_CHAT_TITLE})
      )
      AND (
        SELECT COUNT(*)
        FROM "message" m
        WHERE m."conversation_id" = c."id"
          AND m."role" = 'user'
      ) <= 1
    RETURNING
      "id",
      "workspace_id",
      "user_id",
      "title",
      "type",
      "status",
      "last_message_at",
      "created_at"
  `;

  const row = rows[0];
  return row ? mapConversationRow(row) : null;
}

/**
 * 将数据库行映射为会话 DTO。
 */
function mapConversationRow(row: ConversationRow): ConversationDto {
  const updatedAt = row.last_message_at ?? row.created_at;

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    title: row.title ?? DEFAULT_CHAT_TITLE,
    type: row.type,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

/**
 * 将数据库行映射为请求表单 DTO。
 */
function mapRequestFormRow(row: RequestFormRow): RequestFormDto {
  return {
    id: row.id,
    chatId: row.chat_id,
    version: row.version,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

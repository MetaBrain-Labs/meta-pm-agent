import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

const DEFAULT_CHAT_TITLE = "\u65b0\u5bf9\u8bdd";
const LOCAL_USER_ID = "local";

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

interface RequestFormRow {
  id: string;
  chat_id: string;
  version: number;
  status: string;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ConversationListRow extends ConversationRow {
  request_form_id: string | null;
}

interface ConversationWorkspaceRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  local_path: string | null;
}

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

export interface ConversationListItemDto extends ConversationDto {
  requestFormId?: string;
}

export interface RequestFormDto {
  id: string;
  chatId: string;
  version: number;
  status: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationWorkspaceDto {
  conversationId: string;
  workspaceId: string;
  workspaceName: string;
  localPath: string | null;
}

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
      rf."id" AS "request_form_id"
    FROM "conversation" c
    LEFT JOIN LATERAL (
      SELECT "id"
      FROM "request_form"
      WHERE "chat_id" = c."id"
      ORDER BY "version" DESC, "created_at" DESC
      LIMIT 1
    ) rf ON true
    WHERE c."status" = 'active'
      AND c."workspace_id" = ${workspaceId}
      AND c."user_id" = ${LOCAL_USER_ID}
    ORDER BY COALESCE(c."last_message_at", c."created_at") DESC
  `;

  return rows.map((row) => ({
    ...mapConversationRow(row),
    requestFormId: row.request_form_id ?? undefined,
  }));
}

export async function createConversationWithInitialRequestForm(
  workspaceId: string,
  title: string,
): Promise<{ conversation: ConversationDto; requestForm: RequestFormDto }> {
  const { conversation, requestForm } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "user" ("id", "username")
      VALUES (${LOCAL_USER_ID}, 'Local User')
      ON CONFLICT ("id") DO NOTHING
    `;

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
  });

  return {
    conversation: mapConversationRow(conversation),
    requestForm: mapRequestFormRow(requestForm),
  };
}

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

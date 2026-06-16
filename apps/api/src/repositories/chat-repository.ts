import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

const DEFAULT_CHAT_TITLE = "\u65b0\u5bf9\u8bdd";

interface ChatRow {
  id: string;
  title: string | null;
  status: string | null;
  created_at: Date;
  updated_at: Date;
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

interface ChatListRow extends ChatRow {
  request_form_id: string | null;
}

export interface ChatDto {
  id: string;
  title: string;
  status: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatListItemDto extends ChatDto {
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

export async function listActiveChats(): Promise<ChatListItemDto[]> {
  const rows = await prisma.$queryRaw<ChatListRow[]>`
    SELECT
      c."id",
      c."title",
      c."status",
      c."created_at",
      c."updated_at",
      rf."id" AS "request_form_id"
    FROM "chat" c
    LEFT JOIN LATERAL (
      SELECT "id"
      FROM "request_form"
      WHERE "chat_id" = c."id"
      ORDER BY "version" DESC, "created_at" DESC
      LIMIT 1
    ) rf ON true
    WHERE c."status" = 'active'
    ORDER BY c."updated_at" DESC
  `;

  return rows.map((row) => ({
    ...mapChatRow(row),
    requestFormId: row.request_form_id ?? undefined,
  }));
}

export async function createChatWithInitialRequestForm(
  title: string,
): Promise<{ chat: ChatDto; requestForm: RequestFormDto }> {
  const { chat, requestForm } = await prisma.$transaction(async (tx) => {
    const chats = await tx.$queryRaw<ChatRow[]>`
      INSERT INTO "chat" ("id", "title", "status")
      VALUES (${randomUUID()}, ${title}, 'active')
      RETURNING "id", "title", "status", "created_at", "updated_at"
    `;
    const chat = chats[0];
    if (!chat) {
      throw new Error("Failed to create chat.");
    }

    const requestForms = await tx.$queryRaw<RequestFormRow[]>`
      INSERT INTO "request_form" ("id", "chat_id", "version", "status")
      VALUES (${randomUUID()}, ${chat.id}, 1, 'active')
      RETURNING "id", "chat_id", "version", "status", "summary", "created_at", "updated_at"
    `;
    const requestForm = requestForms[0];
    if (!requestForm) {
      throw new Error("Failed to create request form.");
    }

    return { chat, requestForm };
  });

  return {
    chat: mapChatRow(chat),
    requestForm: mapRequestFormRow(requestForm),
  };
}

function mapChatRow(row: ChatRow): ChatDto {
  return {
    id: row.id,
    title: row.title ?? DEFAULT_CHAT_TITLE,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
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

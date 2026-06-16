import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import { ChatMessageSchema } from "@repo/shared";
import {
  streamConversation,
  type ConversationStreamEvent,
} from "@repo/agent-runtime";
import { writeSse, writeSseDone } from "../utils/sse";
import {
  parseUserInputPayload,
  type UserInputRecord,
} from "../utils/user-input";

const ChatRequestSchema = z.object({
  chatId: z.string().uuid().optional(),
  requestFormId: z.string().uuid().optional(),
  messages: z.array(ChatMessageSchema).min(1),
});

const CreateChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export function createChatRoutes() {
  const routes = new Hono();

  routes.get("/chats", async (c) => {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        title: string | null;
        status: string | null;
        created_at: Date;
        updated_at: Date;
        request_form_id: string | null;
      }>
    >`
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

    return c.json({
      chats: rows.map((row) => ({
        id: row.id,
        requestFormId: row.request_form_id ?? undefined,
        title: row.title ?? "新对话",
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    });
  });

  routes.post("/chats", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const parsed = CreateChatRequestSchema.safeParse(body ?? {});

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const title = parsed.data.title ?? "新对话";
    const { chat, requestForm } = await prisma.$transaction(async (tx) => {
      const chats = await tx.$queryRaw<
        Array<{
          id: string;
          title: string | null;
          status: string | null;
          created_at: Date;
          updated_at: Date;
        }>
      >`
        INSERT INTO "chat" ("id", "title", "status")
        VALUES (${randomUUID()}, ${title}, 'active')
        RETURNING "id", "title", "status", "created_at", "updated_at"
      `;
      const chat = chats[0];
      if (!chat) {
        throw new Error("Failed to create chat.");
      }

      const requestForms = await tx.$queryRaw<
        Array<{
          id: string;
          chat_id: string;
          version: number;
          status: string;
          summary: string | null;
          created_at: Date;
          updated_at: Date;
        }>
      >`
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

    return c.json(
      {
        chat: {
          id: chat.id,
          title: chat.title ?? "新对话",
          status: chat.status,
          createdAt: chat.created_at.toISOString(),
          updatedAt: chat.updated_at.toISOString(),
        },
        requestForm: {
          id: requestForm.id,
          chatId: requestForm.chat_id,
          version: requestForm.version,
          status: requestForm.status,
          summary: requestForm.summary,
          createdAt: requestForm.created_at.toISOString(),
          updatedAt: requestForm.updated_at.toISOString(),
        },
      },
      201,
    );
  });

  routes.post("/chat", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const parsed = ChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    return stream(c, async (writer) => {
      await writeSse(writer, { type: "start" });

      let responseLength = 0;
      let assistantText = "";

      try {
        if (parsed.data.chatId) {
          await persistChatMessages(
            parsed.data.chatId,
            parsed.data.messages,
          );
        }

        for await (const event of streamConversation(
          parsed.data.messages,
        )) {
          if (
            "content" in event &&
            event.type !== "reasoning"
          ) {
            responseLength += event.content.length;
            assistantText += event.content;
          }
          await writeSse(writer, toApiEvent(event));
        }

        if (parsed.data.chatId && assistantText.trim().length > 0) {
          await persistAssistantMessage(
            parsed.data.chatId,
            assistantText,
          );
        }

        if (parsed.data.requestFormId) {
          await persistUserInputItems(
            parsed.data.requestFormId,
            assistantText,
          );
        }

        console.log(
          `[chat] Stream complete, response length: ${responseLength}`,
        );
      } catch (error) {
        console.error("[chat] Error:", error);
        await writeSse(writer, {
          type: "error",
          error: getErrorMessage(error),
        });
      }

      await writeSseDone(writer);
    });
  });

  return routes;
}

async function persistChatMessages(
  chatId: string,
  messages: z.infer<typeof ChatMessageSchema>[],
) {
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

async function persistAssistantMessage(
  chatId: string,
  content: string,
) {
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

async function persistUserInputItems(
  requestFormId: string,
  assistantText: string,
) {
  const items = parseUserInputPayload(assistantText);
  if (!items || items.length === 0) return;

  try {
    await saveRequestFormItems(requestFormId, items);
  } catch (error) {
    console.error("[chat] Failed to persist user_input:", error);
  }
}

async function saveRequestFormItems(
  requestFormId: string,
  items: UserInputRecord[],
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "request_form_item"
      WHERE "form_id" = ${requestFormId}
    `;

    for (const item of items) {
      const payload = JSON.stringify(item);
      await tx.$executeRaw`
        INSERT INTO "request_form_item" (
          "id",
          "form_id",
          "type",
          "status",
          "agent",
          "priority",
          "payload"
        )
        VALUES (
          ${randomUUID()},
          ${requestFormId},
          ${item.type},
          'active',
          'conversation',
          ${item.index},
          ${payload}::json
        )
      `;
    }
  });
}

function toApiEvent(event: ConversationStreamEvent) {
  if (event.type === "reasoning") {
    return {
      type: "thinking" as const,
      content: event.content,
    };
  }

  return event;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

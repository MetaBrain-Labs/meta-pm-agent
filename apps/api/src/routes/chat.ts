import { Hono } from "hono";
import { stream } from "hono/streaming";
import { streamConversation } from "@repo/agent-runtime";
import {
  ChatRequestSchema,
  CreateChatRequestSchema,
} from "../schemas/chat";
import { toApiEvent } from "../services/agent-stream-service";
import {
  createChat,
  listChats,
  persistConversationResult,
  persistConversationStart,
} from "../services/chat-service";
import { writeSse, writeSseDone } from "../utils/sse";

export function createChatRoutes() {
  const routes = new Hono();

  routes.get("/chats", async (c) => {
    return c.json({
      chats: await listChats(),
    });
  });

  routes.post("/chats", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const parsed = CreateChatRequestSchema.safeParse(body ?? {});

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { chat, requestForm } = await createChat(parsed.data.title);

    return c.json({ chat, requestForm }, 201);
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
        await persistConversationStart(
          parsed.data.chatId,
          parsed.data.messages,
        );

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

        await persistConversationResult({
          chatId: parsed.data.chatId,
          requestFormId: parsed.data.requestFormId,
          assistantText,
        });

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

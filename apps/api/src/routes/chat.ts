import { Hono } from "hono";
import { stream } from "hono/streaming";
import { streamConversation } from "@repo/agent-runtime";
import {
  ChatRequestSchema,
  CreateChatRequestSchema,
  CreateWorkspaceRequestSchema,
  ListChatsQuerySchema,
} from "../schemas/chat";
import { toApiEvent } from "../services/agent-stream-service";
import {
  createChat,
  listMessages,
  listChats,
  persistConversationResult,
  persistConversationStart,
} from "../services/chat-service";
import {
  createWorkspace,
  getAccount,
  listWorkspaces,
} from "../services/workspace-service";
import { writeSse, writeSseDone } from "../utils/sse";

export function createChatRoutes() {
  const routes = new Hono();

  routes.get("/account", async (c) => {
    return c.json({
      account: await getAccount(),
    });
  });

  routes.get("/workspaces", async (c) => {
    return c.json({
      workspaces: await listWorkspaces(),
    });
  });

  routes.post("/workspaces", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const parsed = CreateWorkspaceRequestSchema.safeParse(body ?? {});

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    return c.json(
      {
        workspace: await createWorkspace(
          parsed.data.name,
          parsed.data.localPath,
        ),
      },
      201,
    );
  });

  routes.get("/chats", async (c) => {
    const parsed = ListChatsQuerySchema.safeParse({
      workspaceId: c.req.query("workspaceId"),
    });

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    return c.json({
      chats: await listChats(parsed.data.workspaceId),
    });
  });

  routes.get("/chats/:id/messages", async (c) => {
    return c.json({
      messages: await listMessages(c.req.param("id")),
    });
  });

  routes.post("/chats", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const parsed = CreateChatRequestSchema.safeParse(body ?? {});

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { chat, requestForm } = await createChat(
      parsed.data.workspaceId,
      parsed.data.title,
    );

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
      let reasoningContent = "";

      try {
        await persistConversationStart(
          parsed.data.chatId,
          parsed.data.messages,
        );

        for await (const event of streamConversation(
          parsed.data.messages,
        )) {
          if ("content" in event && event.type === "reasoning") {
            reasoningContent += event.content;
          }
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
          conversationId: parsed.data.chatId,
          assistantText,
          reasoningContent,
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

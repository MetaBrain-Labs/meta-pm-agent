import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { ChatMessageSchema } from "@repo/shared";
import {
  streamConversation,
  type ConversationStreamEvent,
} from "@repo/agent-runtime";
import { writeSse, writeSseDone } from "../utils/sse";

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
});

export function createChatRoutes() {
  const routes = new Hono();

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

      try {
        for await (const event of streamConversation(
          parsed.data.messages,
        )) {
          if (
            "content" in event &&
            event.type !== "reasoning"
          ) {
            responseLength += event.content.length;
          }
          await writeSse(writer, toApiEvent(event));
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

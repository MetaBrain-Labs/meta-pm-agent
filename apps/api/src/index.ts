import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { runAgent } from "@repo/agent-runtime";
import { ChatMessage, ChatMessageSchema } from "@repo/shared";

const app = new Hono();

app.use("/*", cors());

const ChatRequestSchema = z.object({
  content: z.string().min(1),
  sessionId: z.string(),
  history: z.array(ChatMessageSchema).optional().default([]),
});

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

app.post("/chat", async (c) => {
  const body = await c.req.json();
  const parsed = ChatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { content, sessionId, history } = parsed.data;

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content,
    timestamp: new Date().toISOString(),
    sessionId,
  };

  const messages = [...history, userMessage];
  const response = await runAgent(messages);
  return c.json(response ?? { content: "No response generated." });
});

serve({ fetch: app.fetch, port: 3001 });

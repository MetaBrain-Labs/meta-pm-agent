import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { runAgent } from "@repo/agent-runtime";
import { ChatMessageSchema } from "@repo/shared";

const app = new Hono();

app.use("/*", cors());

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

app.post("/chat", async (c) => {
  const body = await c.req.json();
  const parsed = ChatMessageSchema.safeParse({
    ...body,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    role: "user",
  });

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const response = await runAgent(parsed.data);
  return c.json(response ?? { content: "No response generated." });
});

serve({ fetch: app.fetch, port: 3001 });

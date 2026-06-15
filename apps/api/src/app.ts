import { Hono } from "hono";
import { cors } from "hono/cors";
import { createChatRoutes } from "./routes/chat";

export function createApp() {
  const app = new Hono();

  app.use("/*", cors());

  app.get("/", (c) => c.json({ status: "ok" }));
  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      agents: ["deepagents-pm-agent"],
    }),
  );

  app.route("/api", createChatRoutes());

  return app;
}

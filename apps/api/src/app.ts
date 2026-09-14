/**
 * 本地 API 应用组装
 *
 * Responsibilities:
 * - 挂载健康检查和业务路由
 * - 限制浏览器跨域请求到明确允许的本地前端
 *
 * Notes:
 * - 当前为单用户本地服务，跨域限制不替代身份认证
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { createChatRoutes } from "./controllers/chat";

/**
 * 创建并配置 Hono 应用实例，挂载 CORS、健康检查和聊天路由。
 */
export function createApp() {
  const app = new Hono();

  const origins = (process.env.CORS_ORIGINS ??
    "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim());
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.origin !== origin
    ) {
      throw new Error("CORS_ORIGINS must contain exact loopback HTTP origins.");
    }
  }

  // 拒绝不可信页面请求，避免仅隐藏响应而仍触发写入或模型调用。
  app.use("/*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !origins.includes(origin)) {
      return c.json({ error: "Browser origin is not allowed." }, 403);
    }
    await next();
  });
  app.use("/*", cors({ origin: origins }));

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

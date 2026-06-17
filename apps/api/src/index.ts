/**
 * API 服务入口，启动 Hono HTTP 服务器。
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

// 启动 Node.js HTTP 服务器，监听指定端口
serve({ fetch: app.fetch, port });

console.log(`[api] Listening on http://localhost:${port}`);

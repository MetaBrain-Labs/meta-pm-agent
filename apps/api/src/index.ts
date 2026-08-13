/**
 * API 服务入口，启动 Hono HTTP 服务器。
 */
import { serve } from "@hono/node-server";
import { installProcessCrashReporter } from "./process-crash-report";

// 先加载仓库环境配置，使显式关闭开关生效；随后在加载应用模块前安装报告器。
await import("./env");
installProcessCrashReporter();

const { createApp } = await import("./app");

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

// 启动 Node.js HTTP 服务器，监听指定端口
serve({ fetch: app.fetch, port });

console.log(`[api] Listening on http://localhost:${port}`);

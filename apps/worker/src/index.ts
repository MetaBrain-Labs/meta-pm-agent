import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Worker, type Job } from "bullmq";

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
});

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  username: process.env.REDIS_USERNAME || undefined,
  db: Number(process.env.REDIS_DB ?? "0"),
  connectTimeout: 10000,
  maxRetriesPerRequest: null,
  retryStrategy(times: number) {
    const delay = Math.min(times * 2000, 30000);
    return delay;
  },
  ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {}),
};

/**
 * 创建消费者
 *   启动一个工作进程，专门监听 chat 队列里的任务：
 */
const worker = new Worker(
  "chat",
  async (job: Job<{ content: string; sessionId: string }>) => {
    console.log(`Processing job ${job.id}:`, job.data.content);
  },
  { connection },
);

let lastErrorTime = 0;

/**
 * 错误节流处理
 *   Redis 断连时，错误事件会高频触发。这里用 lastErrorTime 做 30 秒节流，避免日志刷屏。
 */
worker.on("error", () => {
  const now = Date.now();
  if (now - lastErrorTime > 30000) {
    console.warn(
      `Redis connection error (${connection.host}:${connection.port})`,
    );
    lastErrorTime = now;
  }
});

console.log(`Worker connecting to ${connection.host}:${connection.port}...`);

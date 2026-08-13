/**
 * Chat SSE 写入工具
 *
 * 在 API 网络边界校验公共事件，避免 runtime 内部事件或未声明字段静默进入浏览器。
 *
 * Responsibilities:
 * - 写入经过 ChatSseEventSchema 校验的 JSON 事件
 * - 写入 SSE 完成标记
 */

import { ChatSseEventSchema, type ChatSseEvent } from "@repo/shared";

/** SSE 流写入接口，抽象 Hono stream writer 的写操作。 */
interface StreamWriter {
  write(data: string): Promise<unknown>;
}

/**
 * 向 SSE 流写入一条 JSON 格式的事件数据。
 */
export async function writeSse(
  writer: StreamWriter,
  data: ChatSseEvent,
): Promise<void> {
  await writer.write(`data: ${JSON.stringify(ChatSseEventSchema.parse(data))}\n\n`);
}

/**
 * 向 SSE 流发送 [DONE] 信号，标记流结束。
 */
export async function writeSseDone(
  writer: StreamWriter,
): Promise<void> {
  await writer.write("data: [DONE]\n\n");
}

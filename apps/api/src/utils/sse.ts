/**
 * SSE 流写入接口，抽象 Hono stream writer 的写操作。
 */
interface StreamWriter {
  write(data: string): Promise<unknown>;
}

/**
 * 向 SSE 流写入一条 JSON 格式的事件数据。
 */
export async function writeSse(
  writer: StreamWriter,
  data: unknown,
): Promise<void> {
  await writer.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 向 SSE 流发送 [DONE] 信号，标记流结束。
 */
export async function writeSseDone(
  writer: StreamWriter,
): Promise<void> {
  await writer.write("data: [DONE]\n\n");
}

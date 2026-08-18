/**
 * SSE 写入工具测试
 *
 * 验证心跳注释帧按 SSE 规范以冒号行输出，且与 data 事件帧语义互不干扰。
 *
 * Responsibilities:
 * - 验证 writeSseKeepalive 输出 ": ping" 注释帧
 * - 验证完成标记保持 [DONE] 格式
 */

import assert from "node:assert/strict";
import test from "node:test";
import { writeSseDone, writeSseKeepalive } from "../src/utils/sse";

/** 收集写入内容的极简 writer，供结构断言使用。 */
function captureWriter(): { writes: string[]; write: (data: string) => Promise<void> } {
  const writes: string[] = [];
  return {
    writes,
    write: async (data: string) => {
      writes.push(data);
    },
  };
}

test("writeSseKeepalive emits a colon-prefixed comment frame", async () => {
  const writer = captureWriter();
  await writeSseKeepalive(writer);
  assert.deepEqual(writer.writes, [": ping\n\n"]);
});

test("writeSseDone keeps the [DONE] completion marker format", async () => {
  const writer = captureWriter();
  await writeSseDone(writer);
  assert.deepEqual(writer.writes, ["data: [DONE]\n\n"]);
});

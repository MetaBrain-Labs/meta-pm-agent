/**
 * 文档生成进度持久化测试
 *
 * 验证 reasoning 流式分片只按固定时间窗口落库，避免逐分片数据库写入拖慢
 * 阶段和任务状态同步。
 *
 * Responsibilities:
 * - 验证 reasoning 持久化时间门禁
 *
 * Notes:
 * - 本测试不连接数据库。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_REASONING_PERSIST_INTERVAL_MS,
  shouldPersistDocumentReasoning,
} from "../src/services/document-generation-service";

test("persists document reasoning at most once per interval", () => {
  assert.equal(shouldPersistDocumentReasoning(1_000, 1_999), false);
  assert.equal(
    shouldPersistDocumentReasoning(
      1_000,
      1_000 + DOCUMENT_REASONING_PERSIST_INTERVAL_MS,
    ),
    true,
  );
});

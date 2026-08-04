/**
 * Executor 来源校验重试测试
 *
 * 验证来源校验错误会被识别为可自动修正错误，并把本轮真实搜索来源完整注入重试指令。
 *
 * Responsibilities:
 * - 校验来源错误分类
 * - 校验重试指令保留真实 sourceId、标题和 URL
 *
 * Notes:
 * - 不调用模型或外部搜索。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createWebSearchEvidenceRegistry } from "../src/agents/common/web-search-tool";
import {
  createNodeProvenanceRetryInstruction,
  formatExecutorAttemptErrors,
  getStructuredWriteError,
  isNodeProvenanceValidationFailure,
} from "../src/agents/product-workflow/executor-agent/agent";

test("provenance validation failure produces a retry instruction with exact verified sources", () => {
  const registry = createWebSearchEvidenceRegistry();
  registry.sources.set("9", {
    sourceId: "9",
    title: "Verified collaboration source",
    url: "https://example.com/collaboration",
  });
  const error = new Error(
    'Node provenance validation failed: Evidence "并发编辑模式与同步技术选项": web_source_title_mismatch:9',
  );

  assert.equal(isNodeProvenanceValidationFailure(error), true);
  assert.equal(
    isNodeProvenanceValidationFailure({ error: error.message }),
    true,
  );
  const instruction = createNodeProvenanceRetryInstruction(error, registry);
  assert.match(instruction, /"sourceId":"9"/);
  assert.match(instruction, /Verified collaboration source/);
  assert.match(instruction, /https:\/\/example\.com\/collaboration/);
  assert.match(instruction, /Risk or unverified assumption/);
  assert.match(instruction, /unsupported_infrastructure_scope/);
});

test("terminal retry error preserves both executor attempts", () => {
  const details = formatExecutorAttemptErrors(
    ["first provenance failure", "second provenance failure"],
    new Error("second provenance failure"),
  );

  assert.match(details, /Attempt 1: first provenance failure/);
  assert.match(details, /Attempt 2: second provenance failure/);
});

test("promotes rejected structured writes but ignores duplicate skips", () => {
  assert.match(
    getStructuredWriteError(
      "kg_file_add_relations",
      JSON.stringify({
        skipped: [
          { id: "REL-1", reason: "unauthorized_relation_type:References" },
        ],
      }),
    )?.message ?? "",
    /unauthorized_relation_type:References/,
  );
  assert.equal(
    getStructuredWriteError(
      "kg_file_add_nodes",
      JSON.stringify({
        skipped: [{ id: "G-1", reason: "duplicate_id" }],
      }),
    ),
    null,
  );
});

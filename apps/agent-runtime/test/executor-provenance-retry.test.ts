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
  EXECUTOR_CORRECTION_TOOL_CALL_LIMIT,
  createNodeProvenanceRetryInstruction,
  formatExecutorAttemptErrors,
  getExecutorMaxAttempts,
  getStructuredWriteError,
  isExecutorCorrectionAttempt,
  isNodeProvenanceValidationFailure,
  isSameTaskExecutorRetryable,
  restrictExecutorCorrectionToolNames,
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
  const instruction = createNodeProvenanceRetryInstruction(error, registry, [1]);
  assert.match(instruction, /"sourceId":"9"/);
  assert.match(instruction, /Verified collaboration source/);
  assert.match(instruction, /https:\/\/example\.com\/collaboration/);
  assert.match(instruction, /Risk or unverified assumption/);
  assert.match(instruction, /unsupported_infrastructure_scope/);
  assert.match(instruction, /Valid user_input indexes from this payload: \[1\]/);
  assert.match(instruction, /not question ordinals or blocker indexes/);
});

test("form-answer provenance retry preserves Evidence and uses payload index", () => {
  const instruction = createNodeProvenanceRetryInstruction(
    new Error(
      'Node provenance validation failed: Evidence "性能基线测量计划": unknown_user_input_index:7',
    ),
    createWebSearchEvidenceRegistry(),
    [1],
  );

  assert.match(instruction, /keep the Evidence/);
  assert.match(instruction, /exact matching index from this list/);
  assert.match(instruction, /\[1\]/);
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

test("manual Executor retry is one bounded correction attempt", () => {
  assert.equal(isExecutorCorrectionAttempt(1, true), true);
  assert.equal(isExecutorCorrectionAttempt(1, false), false);
  assert.equal(isExecutorCorrectionAttempt(2, false), true);
  assert.equal(getExecutorMaxAttempts(true), 1);
  assert.equal(getExecutorMaxAttempts(false), 2);
  assert.equal(EXECUTOR_CORRECTION_TOOL_CALL_LIMIT, 8);
});

test("pure unconsumed Evidence correction keeps relation and deprecation tools only", () => {
  const tools = restrictExecutorCorrectionToolNames(
    [
      "kg_file_add_nodes",
      "kg_file_deprecate_nodes",
      "kg_file_add_relations",
    ],
    true,
  );

  assert.deepEqual(tools, [
    "kg_file_deprecate_nodes",
    "kg_file_add_relations",
  ]);
});

test("does not offer same-task retry for a missing deprecation target", () => {
  assert.equal(
    isSameTaskExecutorRetryable(
      "Structured graph write validation failed: OQ-short:missing_deprecation_target",
    ),
    false,
  );
  assert.equal(
    isSameTaskExecutorRetryable(
      "Node provenance validation failed: unsupported_numeric_claims:2026",
    ),
    true,
  );
});

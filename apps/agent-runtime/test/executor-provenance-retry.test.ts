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
import { createProductWorkflowKnowledgeGraph } from "../src/agents/product-workflow/common/knowledge-graph";
import {
  EXECUTOR_CORRECTION_TOOL_CALL_LIMIT,
  createDocumentEvidenceNumericInputRequired,
  createNodeProvenanceRetryInstruction,
  extractUnsupportedNumericClaims,
  formatExecutorAttemptErrors,
  getExecutorMaxAttempts,
  getStructuredWriteError,
  isExecutorCorrectionAttempt,
  isNodeProvenanceValidationFailure,
  isRequiredStructuredWriteMissing,
  isSameTaskExecutorRetryable,
  restrictExecutorCorrectionToolNames,
  shouldRetryEmptyExternalCorrection,
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

test("document numeric provenance gap becomes a targeted same-task HITL", () => {
  const candidateId = "D-cfafdde1-ed04-4a40-bfaa-fdef8487d71f";
  const knowledgeGraph = createProductWorkflowKnowledgeGraph();
  knowledgeGraph.entities.push({
    id: candidateId,
    type: "Decision",
    name: "Candidate performance baseline",
    description:
      "Candidate values are p95=600ms, p99=1200ms, conflict rate 0.8%, and anchor drift 0.3%.",
    source_task_id: "task-old",
    status: "proposed",
    provenance: [{ kind: "existing_graph", node_id: "D-source" }],
  });
  const error = new Error(
    'Attempt 1: Node provenance validation failed: Evidence "Performance baseline": unsupported_numeric_claims:600ms,1200ms,0.8,0.3',
  );
  const inputRequired = createDocumentEvidenceNumericInputRequired({
    details: error,
    task: {
      sequence: 4,
      task_id: "task-04",
      title: "Confirm performance baseline",
      description: `Use candidate ${candidateId} only after confirmation.`,
      assigned_agent: "executor-data-analytics",
      depends_on: [],
      covered_business_model_indexes: [1],
      expected_output: "Confirmed Evidence and Metrics",
      required_open_question_count: 0,
      quality_check: { criteria: ["Use confirmed values only"] },
    },
    agentType: "executor-data-analytics",
    displayName: "Data Analytics Executor",
    knowledgeGraph,
  });

  assert.ok(inputRequired);
  assert.equal(inputRequired.interrupt.taskId, "task-04");
  assert.match(inputRequired.interrupt.details, new RegExp(candidateId));
  assert.match(inputRequired.interrupt.details, /600ms/);
  assert.doesNotMatch(inputRequired.interrupt.neededUserInput, /600ms/);
  assert.match(inputRequired.interrupt.neededUserInput, /完整写出四项数值/);
  assert.deepEqual(extractUnsupportedNumericClaims(error), [
    "600ms",
    "1200ms",
    "0.8",
    "0.3",
  ]);
  assert.deepEqual(
    extractUnsupportedNumericClaims(
      new Error(
        "Attempt 1: Node provenance validation failed: unsupported_numeric_claims:600ms,1200ms | Attempt 2: Node provenance validation failed: unsupported_numeric_claims:0.8,0.3",
      ),
    ),
    ["600ms", "1200ms", "0.8", "0.3"],
  );
});

test("detects a correction response that invoked no structured write", () => {
  const noWriteError = new Error("required-structured-write-not-invoked");
  assert.equal(
    isRequiredStructuredWriteMissing(noWriteError),
    true,
  );
  assert.equal(
    isRequiredStructuredWriteMissing(new Error("invalid_relation_direction")),
    false,
  );
  assert.equal(shouldRetryEmptyExternalCorrection(true, 1, noWriteError), true);
  assert.equal(shouldRetryEmptyExternalCorrection(true, 2, noWriteError), false);
  assert.equal(shouldRetryEmptyExternalCorrection(false, 1, noWriteError), false);
  assert.equal(
    shouldRetryEmptyExternalCorrection(
      true,
      1,
      new Error("invalid_relation_direction"),
    ),
    false,
  );
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

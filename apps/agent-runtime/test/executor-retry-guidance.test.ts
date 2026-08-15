/**
 * Executor 重试指引测试
 *
 * 验证结构化重试与输出校验重试的指令允许并引导模型核实图谱节点 ID，
 * 以及缺失端点失败详情会携带确定性自愈指引，避免盲重试同一错误。
 *
 * Responsibilities:
 * - 断言重试指令包含 kg_file_query_nodes 核实要求
 * - 断言缺失端点详情包含图谱实体 ID 样本与新建节点指引
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendMissingEndpointRecoveryGuidance,
  createOutputValidationRetryInstruction,
  createStructuredWriteRetryInstruction,
} from "../src/agents/product-workflow/executor-agent/agent";
import { createProductWorkflowKnowledgeGraph } from "../src/agents/product-workflow/common/knowledge-graph";

test("structured write retry instruction requires endpoint verification", () => {
  const instruction = createStructuredWriteRetryInstruction(
    new Error(
      "Structured graph write validation failed: REL-1:missing_relation_endpoint:source=M-missing",
    ),
  );

  assert.match(instruction, /kg_file_query_nodes/);
  assert.match(instruction, /verify each rejected endpoint/);
  assert.doesNotMatch(instruction, /do not repeat research or analysis/);
});

test("output validation retry instruction allows verification queries", () => {
  const instruction = createOutputValidationRetryInstruction({
    hasStructuredItems: false,
    blockingQuestionCount: 0,
    requiredBlockingCount: 0,
  });

  assert.match(instruction, /write tools plus read-only graph queries/);
  assert.match(
    instruction,
    /verify every referenced node ID with kg_file_query_nodes/,
  );
  assert.match(
    instruction,
    /Write the minimum required graph items immediately/,
  );
  assert.doesNotMatch(instruction, /do not repeat research or analysis/);
});

test("output validation retry instruction keeps blocking question guidance", () => {
  const instruction = createOutputValidationRetryInstruction({
    hasStructuredItems: true,
    blockingQuestionCount: 0,
    requiredBlockingCount: 2,
  });

  assert.match(instruction, /Persist at least 2 new open questions/);
});

test("missing endpoint recovery guidance lists graph entity ids", () => {
  const graph = createProductWorkflowKnowledgeGraph();
  graph.entities = [
    {
      id: "M-989f5cc8-0e93-451b-8e8a-372f402b0adb",
      type: "Metric",
      name: "成员承载容量",
      description: "月活跃成员数≥100",
      provenance: [{ kind: "user_input", user_input_index: 1 }],
    },
  ];

  const details = appendMissingEndpointRecoveryGuidance(
    "Attempt 2: Structured graph write validation failed: REL-x:missing_relation_endpoint:source=M-989f5cc-0e93-451b-8e8a-372f402b0adb",
    graph,
  );

  assert.match(details, /M-989f5cc8-0e93-451b-8e8a-372f402b0adb/);
  assert.match(details, /kg_file_query_nodes/);
  assert.match(details, /use its returned ID/);
});

test("recovery guidance passes through unrelated failures unchanged", () => {
  const graph = createProductWorkflowKnowledgeGraph();
  const details = "Attempt 1: required-structured-write-not-invoked";

  assert.equal(appendMissingEndpointRecoveryGuidance(details, graph), details);
});

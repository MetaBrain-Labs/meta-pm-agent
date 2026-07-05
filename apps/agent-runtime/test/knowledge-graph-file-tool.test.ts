/**
 * 知识图谱工具追加式写入测试
 *
 * 验证 Executor 结构化工具不会用重复 ID 模拟原地更新，也不会把端点缺失的关系写入运行态知识图谱。
 *
 * Responsibilities:
 * - 校验重复节点 ID 会被跳过
 * - 校验重复关系 ID 会被跳过
 * - 校验端点缺失的关系不会进入图谱状态
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ProductKnowledgeGraph } from "@repo/shared";
import { createKnowledgeGraphTools } from "../src/agents/common/knowledge-graph-file-tool";

test("skips duplicate graph IDs and missing relation endpoints", async () => {
  const state = createKnowledgeGraph();
  const tools = createKnowledgeGraphTools(state);
  const addNodes = getTool(tools, "kg_file_add_nodes");
  const addRelations = getTool(tools, "kg_file_add_relations");

  const nodeResult = JSON.parse(
    String(
      await addNodes.invoke({
        nodes: [
          createNode("G-001", "task-02"),
          createNode("G-002", "task-02"),
          createNode("G-002", "task-02"),
        ],
      }),
    ),
  ) as ToolResult;

  assert.equal(nodeResult.count, 1);
  assert.deepEqual(
    state.entities.map((item) => item.id),
    ["G-001", "G-002"],
  );
  assert.deepEqual(
    nodeResult.skipped?.map((item) => item.id),
    ["G-001", "G-002"],
  );

  const relationResult = JSON.parse(
    String(
      await addRelations.invoke({
        relations: [
          createRelation("REL-001", "G-001", "MISSING"),
          createRelation("REL-002", "G-001", "G-002"),
          createRelation("REL-002", "G-001", "G-002"),
        ],
      }),
    ),
  ) as ToolResult;

  assert.equal(relationResult.count, 1);
  assert.deepEqual(
    state.relations.map((item) => item.id),
    ["REL-002"],
  );
  assert.deepEqual(
    new Set(relationResult.skipped?.map((item) => item.reason)),
    new Set(["duplicate_id_append_only_graph", "missing_relation_endpoint"]),
  );
});

interface ToolResult {
  count: number;
  skipped?: Array<{ id: string; reason: string }>;
}

/**
 * 构造包含一个既有目标节点的最小知识图谱。
 */
function createKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    entities: [
      {
        id: "G-001",
        type: "Goal",
        name: "Existing goal",
        description: "Existing graph node.",
        source_task_id: "task-01",
        status: "proposed",
      },
    ],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    markdown: "",
    notes: [],
  };
}

/**
 * 构造测试节点输入。
 */
function createNode(id: string, sourceTaskId: string) {
  return {
    id,
    type: "Goal",
    name: `Goal ${id}`,
    description: `Goal ${id} description.`,
    source_task_id: sourceTaskId,
    status: "proposed",
  };
}

/**
 * 构造测试关系输入。
 */
function createRelation(id: string, source: string, target: string) {
  return {
    id,
    type: "References",
    source,
    target,
    description: `Relation ${id} description.`,
    source_task_id: "task-02",
  };
}

/**
 * 按名称查找测试所需的结构化工具。
 */
function getTool(
  tools: ReturnType<typeof createKnowledgeGraphTools>,
  name: string,
) {
  const found = tools.find((tool) => tool.name === name);
  assert.ok(found);
  return found;
}

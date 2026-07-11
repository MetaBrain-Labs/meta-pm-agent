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
  assert.deepEqual(nodeResult.items, [{ id: "G-002" }]);

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
  assert.deepEqual(relationResult.items, [{ id: "REL-002" }]);
});

test("skips invalid relation directions and allows corrected resubmission", async () => {
  const state = createKnowledgeGraph();
  const tools = createKnowledgeGraphTools(state);
  const addNodes = getTool(tools, "kg_file_add_nodes");
  const addRelations = getTool(tools, "kg_file_add_relations");

  await addNodes.invoke({
    nodes: [
      createTypedNode("D-001", "Decision"),
      createTypedNode("D-002", "Decision"),
      createTypedNode("R-001", "Requirement"),
      createTypedNode("F-001", "Feature"),
      createTypedNode("C-001", "Component"),
      createTypedNode("C-002", "Component"),
    ],
  });

  const result = JSON.parse(
    String(
      await addRelations.invoke({
        relations: [
          createTypedRelation("REL-DRIVES", "Drives", "D-001", "D-002"),
          createTypedRelation("REL-GOAL-REQ", "Drives", "G-001", "R-001"),
          createTypedRelation(
            "REL-COMPONENT",
            "Implements",
            "C-001",
            "C-002",
          ),
          createTypedRelation("REL-VALID", "Implements", "C-001", "F-001"),
        ],
      }),
    ),
  ) as ToolResult;

  assert.equal(result.count, 1);
  assert.deepEqual(result.items, [{ id: "REL-VALID" }]);
  assert.deepEqual(
    result.skipped?.map((item) => item.reason),
    [
      "invalid_relation_direction:Decision--Drives-->Decision",
      "invalid_relation_direction:Goal--Drives-->Requirement",
      "invalid_relation_direction:Component--Implements-->Component",
    ],
  );

  const corrected = JSON.parse(
    String(
      await addRelations.invoke({
        relations: [
          createTypedRelation(
            "REL-COMPONENT",
            "References",
            "C-001",
            "C-002",
          ),
        ],
      }),
    ),
  ) as ToolResult;
  assert.deepEqual(corrected.items, [{ id: "REL-COMPONENT" }]);
});

test("skips entity and relation types outside the executor profile", async () => {
  const state = createKnowledgeGraph();
  const tools = createKnowledgeGraphTools(state, {
    allowedEntityTypes: ["Evidence", "Metric", "Component"],
    allowedRelationTypes: ["Validates", "Measures", "Implements"],
  });
  const addNodes = getTool(tools, "kg_file_add_nodes");
  const addRelations = getTool(tools, "kg_file_add_relations");
  const addDecisions = getTool(tools, "kg_file_add_decisions");

  const nodeResult = JSON.parse(
    String(
      await addNodes.invoke({
        nodes: [
          createTypedNode("M-001", "Metric"),
          createTypedNode("R-001", "Requirement"),
        ],
      }),
    ),
  ) as ToolResult;
  assert.deepEqual(nodeResult.items, [{ id: "M-001" }]);
  assert.deepEqual(nodeResult.skipped, [
    { id: "R-001", reason: "unauthorized_entity_type:Requirement" },
  ]);

  const relationResult = JSON.parse(
    String(
      await addRelations.invoke({
        relations: [
          createTypedRelation("REL-REF", "References", "M-001", "G-001"),
          createTypedRelation("REL-MEASURE", "Measures", "M-001", "G-001"),
        ],
      }),
    ),
  ) as ToolResult;
  assert.deepEqual(relationResult.items, [{ id: "REL-MEASURE" }]);
  assert.deepEqual(relationResult.skipped, [
    { id: "REL-REF", reason: "unauthorized_relation_type:References" },
  ]);

  const decisionResult = JSON.parse(
    String(
      await addDecisions.invoke({
        decisions: [{ id: "D-001", text: "Unauthorized decision" }],
      }),
    ),
  ) as ToolResult;
  assert.equal(decisionResult.count, 0);
  assert.deepEqual(decisionResult.skipped, [
    { id: "D-001", reason: "unauthorized_entity_type:Decision" },
  ]);
});

interface ToolResult {
  count: number;
  items: Array<{ id: string }>;
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
 * 构造指定类型的测试节点。
 */
function createTypedNode(
  id: string,
  type: ProductKnowledgeGraph["entities"][number]["type"],
) {
  return {
    id,
    type,
    name: `${type} ${id}`,
    description: `${type} ${id} description.`,
    source_task_id: "task-02",
    status: "proposed" as const,
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
 * 构造指定类型的测试关系。
 */
function createTypedRelation(
  id: string,
  type: ProductKnowledgeGraph["relations"][number]["type"],
  source: string,
  target: string,
) {
  return {
    id,
    type,
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
): { invoke(input: unknown): Promise<unknown> } {
  const found = tools.find((tool) => tool.name === name);
  assert.ok(found);
  return found as unknown as { invoke(input: unknown): Promise<unknown> };
}

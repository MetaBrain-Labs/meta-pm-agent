/**
 * 知识图谱工具追加式写入测试
 *
 * 验证 Executor 结构化工具不会用重复 ID 模拟原地更新，也不会把端点缺失的关系写入运行态知识图谱。
 *
 * Responsibilities:
 * - 校验重复节点 ID 会被跳过
 * - 校验重复关系 ID 会被自动重映射
 * - 校验端点缺失的关系不会进入图谱状态
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ProductKnowledgeGraph } from "@repo/shared";
import { createKnowledgeGraphTools } from "../src/agents/common/knowledge-graph-file-tool";

test("atomically allocates graph IDs and skips missing relation endpoints", async () => {
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

  assert.equal(nodeResult.count, 3);
  assert.equal(new Set(state.entities.map((item) => item.id)).size, 4);
  assert.equal(nodeResult.items.every((item) => /^G-[0-9a-f-]{36}$/.test(item.id)), true);
  const [firstNode, secondNode] = nodeResult.items;
  assert.ok(firstNode && secondNode);

  const relationResult = JSON.parse(
    String(
      await addRelations.invoke({
        relations: [
          createRelation("REL-001", "G-001", "MISSING"),
          createRelation("REL-002", "G-001", firstNode.id),
          createRelation("REL-002", "G-001", secondNode.id),
        ],
      }),
    ),
  ) as ToolResult;

  assert.equal(relationResult.count, 2);
  assert.equal(new Set(state.relations.map((item) => item.id)).size, 2);
  assert.deepEqual(
    new Set(relationResult.skipped?.map((item) => item.reason)),
    new Set(["missing_relation_endpoint"]),
  );
  assert.equal(
    relationResult.items.every((item) => /^REL-[0-9a-f-]{36}$/.test(item.id)),
    true,
  );
});

test("requires decision metadata to reuse a canonical Decision node ID", async () => {
  const state = createKnowledgeGraph();
  const tools = createKnowledgeGraphTools(state);
  const addNodes = getTool(tools, "kg_file_add_nodes");
  const addDecisions = getTool(tools, "kg_file_add_decisions");

  const nodeResult = JSON.parse(String(await addNodes.invoke({
    nodes: [createTypedNode("D-001", "Decision")],
  }))) as ToolResult;
  const decisionNodeId = nodeResult.items[0]?.id;
  assert.ok(decisionNodeId);
  const result = JSON.parse(
    String(
      await addDecisions.invoke({
        decisions: [
          { id: decisionNodeId, text: "Canonical decision" },
          { id: "DEC-001", text: "Legacy duplicate" },
        ],
      }),
    ),
  ) as ToolResult;

  assert.deepEqual(result.items, [{ id: decisionNodeId }]);
  assert.deepEqual(result.skipped, [
    { id: "DEC-001", reason: "missing_canonical_decision_node" },
  ]);
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
  const decisionIds = state.entities
    .filter((item) => item.type === "Decision")
    .map((item) => item.id);
  const requirementId = state.entities.find((item) => item.type === "Requirement")?.id;
  const featureId = state.entities.find((item) => item.type === "Feature")?.id;
  const componentIds = state.entities
    .filter((item) => item.type === "Component")
    .map((item) => item.id);
  assert.ok(decisionIds[0] && decisionIds[1] && requirementId && featureId);
  assert.ok(componentIds[0] && componentIds[1]);

  const result = JSON.parse(
    String(
      await addRelations.invoke({
        relations: [
          createTypedRelation("REL-DRIVES", "Drives", decisionIds[0], decisionIds[1]),
          createTypedRelation("REL-GOAL-REQ", "Drives", "G-001", requirementId),
          createTypedRelation(
            "REL-COMPONENT",
            "Implements",
            componentIds[0],
            componentIds[1],
          ),
          createTypedRelation("REL-VALID", "Implements", componentIds[0], featureId),
        ],
      }),
    ),
  ) as ToolResult;

  assert.equal(result.count, 1);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0]!.id, /^REL-[0-9a-f-]{36}$/);
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
            componentIds[0],
            componentIds[1],
          ),
        ],
      }),
    ),
  ) as ToolResult;
  assert.equal(corrected.items.length, 1);
  assert.match(corrected.items[0]!.id, /^REL-[0-9a-f-]{36}$/);
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
  assert.equal(nodeResult.items.length, 1);
  const metricId = nodeResult.items[0]!.id;
  assert.match(metricId, /^M-[0-9a-f-]{36}$/);
  assert.equal(nodeResult.skipped?.[0]?.reason, "unauthorized_entity_type:Requirement");

  const relationResult = JSON.parse(
    String(
      await addRelations.invoke({
        relations: [
          createTypedRelation("REL-REF", "References", metricId, "G-001"),
          createTypedRelation("REL-MEASURE", "Measures", metricId, "G-001"),
        ],
      }),
    ),
  ) as ToolResult;
  assert.equal(relationResult.items.length, 1);
  assert.match(relationResult.items[0]!.id, /^REL-[0-9a-f-]{36}$/);
  assert.equal(relationResult.skipped?.[0]?.reason, "unauthorized_relation_type:References");

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

test("atomically allocates risk and OpenQuestion IDs despite duplicate hints", async () => {
  const state = createKnowledgeGraph();
  const tools = createKnowledgeGraphTools(state);
  const addRisks = getTool(tools, "kg_file_add_risks");
  const addQuestions = getTool(tools, "kg_file_add_open_questions");

  const riskResult = JSON.parse(String(await addRisks.invoke({
    risks: [
      { id: "RISK-001", text: "First risk" },
      { id: "RISK-001", text: "Second risk" },
    ],
  }))) as ToolResult;
  const questionResult = JSON.parse(String(await addQuestions.invoke({
    questions: [
      { id: "OQ-001", user_language: "zh", text: "问题一？", blocking: true },
      { id: "OQ-001", user_language: "zh", text: "问题二？", blocking: false },
    ],
  }))) as ToolResult;

  assert.equal(riskResult.count, 2);
  assert.equal(questionResult.count, 2);
  assert.equal(new Set(riskResult.items.map((item) => item.id)).size, 2);
  assert.equal(new Set(questionResult.items.map((item) => item.id)).size, 2);
  assert.equal(questionResult.items.every((item) => /^OQ-[0-9a-f-]{36}$/.test(item.id)), true);
});

test("requires the configured number of blocking OpenQuestions", async () => {
  const state = createKnowledgeGraph();
  const addQuestions = getTool(
    createKnowledgeGraphTools(state, {
      requiredBlockingOpenQuestionCount: 2,
    }),
    "kg_file_add_open_questions",
  );

  await assert.rejects(
    addQuestions.invoke({
      questions: [
        {
          user_language: "en",
          text: "Which deployment model should be used?",
          blocking: true,
        },
        {
          user_language: "en",
          text: "Which later optimization should be considered?",
          blocking: false,
        },
      ],
    }),
    /at least 2 questions with blocking=true/i,
  );
  assert.equal(state.open_questions.length, 0);

  await addQuestions.invoke({
    questions: [
      {
        user_language: "en",
        text: "Which deployment model should be used?",
        blocking: true,
      },
      {
        user_language: "en",
        text: "Which access policy should be used?",
        blocking: true,
      },
    ],
  });
  assert.equal(state.open_questions.length, 2);
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

/**
 * 产品知识图谱并行合并测试
 *
 * 验证多个 Executor 基于同一图谱快照并行写入时，重复 ID 不会被后到分支覆盖。
 * 相似内容应去重保留一个，非相似内容应生成递增 ID 并同步重写关系端点。
 *
 * Responsibilities:
 * - 覆盖 LangGraph knowledgeGraph reducer 的重复 ID 合并策略
 * - 覆盖 Critique 确定性校验对重编号提交结果的识别
 * - 防止 DUPLICATE_ENTITY_ID / DUPLICATE_RELATION_ID / SOURCE_CONFLICT 回归
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutorAgentResult,
  ProductKnowledgeGraph,
  RequestAnalysis,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import { createCritiqueValidationReport } from "../src/agents/product-workflow/critique-agent/agent";
import { mergeKnowledgeGraphSnapshots } from "../src/graph/state";

test("renames non-similar duplicate IDs and remaps relation endpoints", () => {
  const current = createCurrentGraphWithTask03();
  const update = createGraph({
    entities: [
      createRequirement(
        "R-003",
        "task-02",
        "Integration toolkit requirement",
        "Define SDK, webhook, and connector requirements for enterprise integrations.",
      ),
    ],
    relations: [
      createRelation(
        "REL-003",
        "R-003",
        "G-001",
        "task-02",
        "Integration toolkit requirement supports the workspace automation goal.",
      ),
    ],
  });

  const merged = mergeKnowledgeGraphSnapshots(current, update);

  assert.ok(merged);
  const task02Entity = merged.entities.find(
    (entity) => entity.source_task_id === "task-02",
  );
  const task02Relation = merged.relations.find(
    (relation) => relation.source_task_id === "task-02",
  );

  assert.equal(task02Entity?.id, "R-006");
  assert.equal(task02Relation?.id, "REL-018");
  assert.equal(task02Relation?.source, "R-006");
  assert.equal(task02Relation?.target, "G-001");
  assert.equal(
    merged.entities.find((entity) => entity.id === "R-003")?.source_task_id,
    "task-03",
  );
});

test("deduplicates similar duplicate IDs without inserting a second item", () => {
  const current = createGraph({
    entities: [
      createRequirement(
        "R-003",
        "task-03",
        "Checkout payment failure",
        "Users abandon checkout when card authorization fails during payment.",
      ),
    ],
  });
  const update = createGraph({
    entities: [
      createRequirement(
        "R-003",
        "task-02",
        "Checkout payment failure issue",
        "Users abandon checkout when payment card authorization fails.",
      ),
    ],
  });

  const merged = mergeKnowledgeGraphSnapshots(current, update);

  assert.ok(merged);
  assert.deepEqual(
    merged.entities.map((entity) => entity.id),
    ["R-003"],
  );
  assert.equal(merged.entities[0].source_task_id, "task-03");
});

test("merges product context metadata without losing graph items", () => {
  const current = createGraph({
    entities: [createGoal("G-001")],
  });
  const update = createGraph({
    relations: [
      createRelation(
        "REL-001",
        "G-001",
        "G-001",
        "task-02",
        "Self-reference for metadata merge coverage.",
      ),
    ],
  });
  current.current_state = "initial";
  current.description = "Orchestrator Agent started the workflow.";
  update.current_state = "building";
  update.description = "Executor Agent updated the product context.";

  const merged = mergeKnowledgeGraphSnapshots(current, update);

  assert.ok(merged);
  assert.equal(merged.current_state, "building");
  assert.deepEqual(merged.description?.split("\n"), [
    "Orchestrator Agent started the workflow.",
    "Executor Agent updated the product context.",
  ]);
  assert.equal(merged.entities.length, 1);
  assert.equal(merged.relations.length, 1);
});

test("critique validation accepts graph items normalized by merge reducer", () => {
  const task03Result = createExecutorResult({
    taskId: "task-03",
    agentType: "executor-product-discovery",
    entity: createRequirement(
      "R-003",
      "task-03",
      "Discovery interview requirement",
      "Capture target-user interview requirements for onboarding research.",
    ),
    relation: createRelation(
      "REL-003",
      "R-003",
      "G-001",
      "task-03",
      "Discovery interview requirement supports the workspace automation goal.",
    ),
  });
  const task02Result = createExecutorResult({
    taskId: "task-02",
    agentType: "executor-toolkit",
    entity: createRequirement(
      "R-003",
      "task-02",
      "Integration toolkit requirement",
      "Define SDK, webhook, and connector requirements for enterprise integrations.",
    ),
    relation: createRelation(
      "REL-003",
      "R-003",
      "G-001",
      "task-02",
      "Integration toolkit requirement supports the workspace automation goal.",
    ),
  });
  const mergedGraph = mergeKnowledgeGraphSnapshots(
    createCurrentGraphWithTask03(),
    createGraph({
      entities: task02Result.entities,
      relations: task02Result.relations,
    }),
  );

  assert.ok(mergedGraph);
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: createPlan(),
    executorResults: [task02Result, task03Result],
    knowledgeGraph: mergedGraph,
  });

  assert.deepEqual(report.rejected_task_ids, []);
  assert.deepEqual(report.retry_task_ids, []);
  assert.equal(
    report.issues.some((issue) =>
      [
        "DUPLICATE_ENTITY_ID",
        "DUPLICATE_RELATION_ID",
        "ENTITY_SOURCE_CONFLICT",
        "RELATION_SOURCE_CONFLICT",
      ].includes(issue.code),
    ),
    false,
  );
  assert.equal(
    report.executor_update_records.find(
      (record) => record.task_id === "task-02",
    )?.commit_status,
    "committed",
  );
  assert.deepEqual(
    report.executor_update_records.find(
      (record) => record.task_id === "task-02",
    )?.committed_entity_ids,
    ["R-006"],
  );
});

/**
 * 构造包含 task-03 已提交项的图谱，用于模拟先合并的并行分支。
 */
function createCurrentGraphWithTask03(): ProductKnowledgeGraph {
  return createGraph({
    entities: [
      createGoal("G-001"),
      createRequirement(
        "R-003",
        "task-03",
        "Discovery interview requirement",
        "Capture target-user interview requirements for onboarding research.",
      ),
      createRequirement(
        "R-004",
        "task-03",
        "Research sample requirement",
        "Define minimum sample size for onboarding discovery interviews.",
      ),
      createRequirement(
        "R-005",
        "task-03",
        "Research synthesis requirement",
        "Summarize discovery evidence into prioritized onboarding insights.",
      ),
    ],
    relations: [
      createRelation(
        "REL-003",
        "R-003",
        "G-001",
        "task-03",
        "Discovery interview requirement supports the workspace automation goal.",
      ),
      createRelation(
        "REL-017",
        "R-005",
        "G-001",
        "task-03",
        "Research synthesis requirement references the workspace automation goal.",
      ),
    ],
  });
}

/**
 * 构造最小产品知识图谱。
 */
function createGraph({
  entities = [],
  relations = [],
}: {
  entities?: ProductKnowledgeGraph["entities"];
  relations?: ProductKnowledgeGraph["relations"];
}): ProductKnowledgeGraph {
  return {
    entities,
    relations,
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    markdown: "",
    notes: [],
  };
}

/**
 * 构造测试目标节点。
 */
function createGoal(id: string): ProductKnowledgeGraph["entities"][number] {
  return {
    id,
    type: "Goal",
    name: "Workspace automation goal",
    description: "Improve workspace automation for product teams.",
    source_task_id: "task-01",
    status: "proposed",
  };
}

/**
 * 构造测试需求节点。
 */
function createRequirement(
  id: string,
  sourceTaskId: string,
  name: string,
  description: string,
): ProductKnowledgeGraph["entities"][number] {
  return {
    id,
    type: "Requirement",
    name,
    description,
    source_task_id: sourceTaskId,
    status: "proposed",
  };
}

/**
 * 构造测试关系。
 */
function createRelation(
  id: string,
  source: string,
  target: string,
  sourceTaskId: string,
  description: string,
): ProductKnowledgeGraph["relations"][number] {
  return {
    id,
    type: "Satisfies",
    source,
    target,
    description,
    source_task_id: sourceTaskId,
  };
}

/**
 * 构造 Critique 校验所需的 Executor 结果。
 */
function createExecutorResult({
  taskId,
  agentType,
  entity,
  relation,
}: {
  taskId: string;
  agentType: ExecutorAgentResult["agent_type"];
  entity: ProductKnowledgeGraph["entities"][number];
  relation: ProductKnowledgeGraph["relations"][number];
}): ExecutorAgentResult {
  return {
    task_id: taskId,
    agent_type: agentType,
    focus_layer: "Requirement",
    summary: `${taskId} summary`,
    entities: [entity],
    relations: [relation],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: {
      passed: true,
      notes: "ok",
    },
  };
}

/**
 * 构造 Critique 校验所需的最小任务计划。
 */
function createPlan(): TaskExecutionPlan {
  const tasks = [
    createTask("task-02", 2, "executor-toolkit"),
    createTask("task-03", 3, "executor-product-discovery"),
  ];

  return {
    status: "initial",
    request_summary: "Design a workspace automation workflow.",
    dag: {
      nodes: tasks.map((task) => task.task_id),
      edges: [],
    },
    tasks,
    assumptions: [],
  };
}

/**
 * 构造测试任务节点。
 */
function createTask(
  taskId: string,
  sequence: number,
  assignedAgent: TaskExecutionNode["assigned_agent"],
): TaskExecutionNode {
  return {
    task_id: taskId,
    sequence,
    title: `${taskId} title`,
    description: `${taskId} description`,
    assigned_agent: assignedAgent,
    depends_on: [],
    covered_business_model_indexes: [1],
    expected_output: "Update the product knowledge graph.",
    quality_check: {
      status: "pending",
      criteria: ["Must write traceable graph items."],
    },
  };
}

/**
 * 构造 Critique 校验所需的最小 Request Agent 分析。
 */
function createRequestAnalysis(): RequestAnalysis {
  return {
    business_model: [
      {
        index: 1,
        user_goal: "Design a workspace automation workflow.",
        goal_constraints: ["Keep graph updates traceable."],
        missing_information: [],
        covered_user_input_indexes: [1],
      },
    ],
    questions: [],
    chitchat: [],
  };
}

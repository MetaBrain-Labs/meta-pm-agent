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
  CritiqueAgentOutput,
  ExecutorAgentResult,
  ProductKnowledgeGraph,
  RequestAnalysis,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import {
  compactTaskSemanticUpdates,
  composeProductWorkflowResult,
  createCritiqueValidationReport,
} from "../src/agents/product-workflow/critique-agent/agent";
import { hasStructuredGraphItems } from "../src/agents/product-workflow/executor-agent/agent";
import { mergeKnowledgeGraphSnapshots } from "../src/graph/state";

test("retries only when an executor wrote no structured graph items", () => {
  const emptyGraph = createGraph({});
  emptyGraph.summary.push("Summary alone is not a graph patch.");

  assert.equal(hasStructuredGraphItems(emptyGraph), false);
  emptyGraph.entities.push(createGoal("G-001"));
  assert.equal(hasStructuredGraphItems(emptyGraph), true);
});

test("keeps compact semantic updates reviewable without copying the full graph", () => {
  const entity = createRequirement(
    "R-001",
    "task-01",
    "Concurrent editing",
    "The product supports concurrent editing.",
  );
  const result = createExecutorResult({
    taskId: "task-01",
    agentType: "executor-product-strategy",
    entity,
    relation: createRelation(
      "REL-001",
      "G-001",
      entity.id,
      "task-01",
      "The goal references the requirement.",
    ),
  });

  const updates = compactTaskSemanticUpdates([result]);

  assert.equal(updates[0]?.entities[0]?.description, entity.description);
  assert.equal(updates[0]?.relations[0]?.target, entity.id);
});

test("critique validation rejects executor boundary violations", () => {
  const feature: ProductKnowledgeGraph["entities"][number] = {
    id: "F-001",
    type: "Feature",
    name: "Shared editing",
    description: "Allow users to edit one document together.",
    source_task_id: "task-00",
    status: "proposed",
  };
  const component: ProductKnowledgeGraph["entities"][number] = {
    id: "C-001",
    type: "Component",
    name: "Collaboration gateway",
    description: "Coordinates shared editing sessions.",
    source_task_id: "task-01",
    status: "proposed",
  };
  const requirement = createRequirement(
    "R-001",
    "task-01",
    "Concurrent editing requirement",
    "The product supports multiple active editors.",
  );
  const relations: ProductKnowledgeGraph["relations"] = [
    {
      id: "REL-001",
      type: "Implements",
      source: component.id,
      target: feature.id,
      source_task_id: "task-01",
    },
    createRelation(
      "REL-002",
      requirement.id,
      feature.id,
      "task-01",
      "The requirement references the collaboration feature.",
    ),
  ];
  const task = createTask("task-01", 1, "executor-toolkit");
  const result: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: "executor-toolkit",
    focus_layer: "Component",
    summary: "Created collaboration constraints.",
    entities: [component, requirement],
    relations,
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review executor boundaries.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [result],
    knowledgeGraph: createGraph({
      entities: [feature, component, requirement],
      relations,
    }),
  });

  assert.deepEqual(report.rejected_task_ids, ["task-01"]);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ["UNAUTHORIZED_ENTITY_TYPE", "UNAUTHORIZED_RELATION_TYPE"],
  );
});

test("critique validation rejects a task that omits its required blocking question", () => {
  const task = {
    ...createTask("task-01", 1, "executor-product-discovery"),
    required_open_question_count: 1,
  };
  const requirement = createRequirement(
    "R-001",
    "seed-task",
    "Concurrent editing",
    "The product supports concurrent editing.",
  );
  const feature: ProductKnowledgeGraph["entities"][number] = {
    id: "F-001",
    type: "Feature",
    name: "Shared editing",
    description: "Allow users to edit one document together.",
    source_task_id: task.task_id,
    status: "proposed",
  };
  const relation: ProductKnowledgeGraph["relations"][number] = {
    id: "REL-001",
    type: "Satisfies",
    source: feature.id,
    target: requirement.id,
    source_task_id: task.task_id,
  };
  const result: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Feature",
    summary: "Created the collaboration feature.",
    entities: [feature],
    relations: [relation],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const graph = createGraph({
    entities: [requirement, feature],
    relations: [relation],
  });

  const missing = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review blocking question persistence.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [result],
    knowledgeGraph: graph,
  });
  const present = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review blocking question persistence.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        ...result,
        open_questions: [
          { id: "OQ-runtime-allocated", text: "Expected concurrency?", blocking: true },
        ],
      },
    ],
    knowledgeGraph: graph,
  });

  assert.deepEqual(missing.rejected_task_ids, [task.task_id]);
  assert.equal(
    missing.issues.some(
      (issue) => issue.code === "MISSING_REQUIRED_BLOCKING_QUESTIONS",
    ),
    true,
  );
  assert.deepEqual(present.rejected_task_ids, []);
});

test("critique composition keeps runtime validation and graph counts authoritative", () => {
  const task = createTask("task-01", 1, "executor-product-strategy");
  const goal = createGoal("G-001");
  const requirement = createRequirement(
    "R-001",
    task.task_id,
    "Confirmed requirement",
    "The user confirmed this product requirement.",
  );
  const relation = createRelation(
    "REL-001",
    requirement.id,
    goal.id,
    task.task_id,
    "The requirement references the product goal.",
  );
  const executorResult: ExecutorAgentResult = {
    task_id: task.task_id,
    agent_type: task.assigned_agent,
    focus_layer: "Requirement",
    summary: "Created a confirmed requirement.",
    entities: [requirement],
    relations: [relation],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const graph = createGraph({
    entities: [goal, requirement],
    relations: [relation],
  });
  const plan = {
    status: "supplement" as const,
    request_summary: "Confirm the requirement.",
    dag: { nodes: [task.task_id], edges: [] },
    tasks: [task],
    assumptions: [],
  };
  const modelReview: CritiqueAgentOutput = {
    status: "completed",
    confirmation_id: "review-1",
    request_summary: "Confirm the requirement.",
    review: {
      accepted_task_ids: ["invented-task"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: "ok",
    },
    product_context_update: "Requirement confirmed.",
    knowledge_graph_review: {
      graph_ref: { entity_count: 999, relation_count: 999 },
      accepted_task_ids: ["invented-task"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: ["ok"],
    },
    proposal_questions: [],
    confirmation_message: "Complete.",
  };

  const result = composeProductWorkflowResult(
    {
      requestAnalysis: createRequestAnalysis(),
      plan,
      executorResults: [executorResult],
      knowledgeGraph: graph,
    },
    modelReview,
  );

  assert.deepEqual(result.review.accepted_task_ids, [task.task_id]);
  assert.deepEqual(result.knowledge_graph_review?.graph_ref, {
    entity_count: 2,
    relation_count: 1,
  });
});

test("critique validation warns when a task patch exceeds the soft ceiling", () => {
  const task = createTask("task-01", 1, "executor-product-strategy");
  const entities = Array.from({ length: 9 }, (_, index) =>
    createRequirement(
      `R-${index + 1}`,
      task.task_id,
      `Requirement ${index + 1}`,
      `Requirement ${index + 1} description.`,
    ),
  );
  const report = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Create requirements.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task.task_id,
        agent_type: task.assigned_agent,
        focus_layer: "Requirement",
        summary: "Created requirements.",
        entities,
        relations: [],
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: createGraph({ entities }),
  });

  assert.equal(
    report.issues.some((issue) => issue.code === "TASK_PATCH_SIZE_EXCEEDED"),
    true,
  );
  assert.deepEqual(report.retry_task_ids, []);
});

test("critique validation warns about duplicate metrics", () => {
  const task = createTask("task-01", 1, "executor-data-analytics");
  const goal = createGoal("G-001");
  const metrics: ProductKnowledgeGraph["entities"] = [
    {
      id: "M-001",
      type: "Metric",
      name: "Offline sync success rate",
      description: "Measure the successful completion rate of offline synchronization.",
      source_task_id: task.task_id,
      status: "proposed",
    },
    {
      id: "M-002",
      type: "Metric",
      name: "Offline synchronization success rate",
      description: "Measure successful completion of offline document synchronization.",
      source_task_id: task.task_id,
      status: "proposed",
    },
  ];
  const relations: ProductKnowledgeGraph["relations"] = metrics.map(
    (metric, index) => ({
      id: `REL-${index + 1}`,
      type: "Measures",
      source: metric.id,
      target: goal.id,
      source_task_id: task.task_id,
    }),
  );
  const report = createCritiqueValidationReport({
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Define metrics.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task.task_id,
        agent_type: task.assigned_agent,
        focus_layer: "Metric",
        summary: "Defined metrics.",
        entities: metrics,
        relations,
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: createGraph({
      entities: [goal, ...metrics],
      relations,
    }),
  });

  assert.equal(
    report.issues.some((issue) => issue.code === "DUPLICATE_METRIC"),
    true,
  );
  assert.deepEqual(report.retry_task_ids, []);
});

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
    agentType: "executor-market-research",
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

test("critique validation does not duplicate chained relation renames", () => {
  const goal = createGoal("G-001");
  const task03Entities = Array.from({ length: 11 }, (_, index) =>
    createRequirement(
      `R-${index + 11}`,
      "task-03",
      `Research requirement ${index + 1}`,
      `Research evidence requirement ${index + 1}.`,
    ),
  );
  const task04Entities = Array.from({ length: 20 }, (_, index) => ({
    id: `F-${index + 11}`,
    type: "Feature" as const,
    name: `Discovery feature ${index + 1}`,
    description: `Discovery feature hypothesis ${index + 1}.`,
    source_task_id: "task-04",
    status: "proposed" as const,
  }));
  const task03Relations = task03Entities.map((entity, index) =>
    createRelation(
      `REL-${index + 11}`,
      entity.id,
      goal.id,
      "task-03",
      `Research relation ${index + 1}.`,
    ),
  );
  const task04Relations = task04Entities.map((entity, index) =>
    createRelation(
      `REL-${index + 11}`,
      entity.id,
      goal.id,
      "task-04",
      `Discovery relation ${index + 1}.`,
    ),
  );
  const mergedGraph = mergeKnowledgeGraphSnapshots(
    createGraph({
      entities: [goal, ...task03Entities],
      relations: task03Relations,
    }),
    createGraph({
      entities: task04Entities,
      relations: task04Relations,
    }),
  );
  assert.ok(mergedGraph);

  const task04 = createTask("task-04", 4, "executor-product-discovery");
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Create discovery features.",
      dag: { nodes: [task04.task_id], edges: [] },
      tasks: [task04],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task04.task_id,
        agent_type: "executor-product-discovery",
        focus_layer: "Feature",
        summary: "Created discovery features.",
        entities: task04Entities,
        relations: task04Relations,
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: mergedGraph,
  });
  const record = report.executor_update_records[0];

  assert.deepEqual(record.committed_relation_ids, [
    ...Array.from({ length: 20 }, (_, index) => `REL-${index + 22}`),
  ]);
  assert.equal(new Set(record.committed_relation_ids).size, 20);
  assert.deepEqual(report.rejected_task_ids, []);
});

test("critique validation reports pre-existing integrity failures as legacy warnings", () => {
  const graph = createGraph({
    entities: [
      createGoal("G-001"),
      createRequirement(
        "R-001",
        "task-01",
        "Invalidly connected requirement",
        "This requirement is connected through an invalid direction.",
      ),
      createRequirement(
        "R-002",
        "task-01",
        "Orphan requirement",
        "This requirement has no relation.",
      ),
      {
        id: "F-001",
        type: "Feature",
        name: "Orphan feature",
        description: "This feature has no relation.",
        source_task_id: "task-01",
        status: "proposed",
      },
    ],
    relations: [
      {
        id: "REL-INVALID",
        type: "Drives",
        source: "G-001",
        target: "R-001",
        source_task_id: "task-01",
      },
      {
        id: "REL-DANGLING",
        type: "References",
        source: "G-001",
        target: "MISSING",
        source_task_id: "task-01",
      },
    ],
  });
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review graph integrity.",
      dag: { nodes: [], edges: [] },
      tasks: [],
      assumptions: [],
    },
    executorResults: [],
    knowledgeGraph: graph,
  });

  assert.deepEqual(report.graph_integrity.dangling_relation_ids, [
    "REL-DANGLING",
  ]);
  assert.deepEqual(report.graph_integrity.invalid_direction_relation_ids, [
    "REL-INVALID",
  ]);
  assert.deepEqual(report.graph_integrity.orphan_requirement_ids, ["R-002"]);
  assert.deepEqual(report.graph_integrity.orphan_feature_ids, ["F-001"]);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    [
      "LEGACY_RELATION_ENDPOINT_MISSING",
      "LEGACY_INVALID_RELATION_DIRECTION",
      "ORPHAN_REQUIREMENT",
      "ORPHAN_FEATURE",
    ],
  );
  assert.ok(report.issues.every((issue) => issue.severity === "warning"));
  assert.deepEqual(report.retry_task_ids, []);
});

test("critique validation rejects invalid relations committed by the current task", () => {
  const invalidRelation: ProductKnowledgeGraph["relations"][number] = {
    id: "REL-INVALID",
    type: "Drives",
    source: "G-001",
    target: "R-001",
    source_task_id: "task-01",
  };
  const graph = createGraph({
    entities: [
      createGoal("G-001"),
      createRequirement(
        "R-001",
        "task-01",
        "Invalidly connected requirement",
        "This requirement is connected through an invalid direction.",
      ),
    ],
    relations: [invalidRelation],
  });
  const task = createTask("task-01", 1, "executor-product-strategy");
  const report = createCritiqueValidationReport({
    workspaceId: "workspace-test",
    productContext: "",
    requestAnalysis: createRequestAnalysis(),
    plan: {
      status: "initial",
      request_summary: "Review current graph updates.",
      dag: { nodes: [task.task_id], edges: [] },
      tasks: [task],
      assumptions: [],
    },
    executorResults: [
      {
        task_id: task.task_id,
        agent_type: "executor-product-strategy",
        focus_layer: "Goal",
        summary: "Added an invalid relation.",
        entities: [],
        relations: [invalidRelation],
        decisions: [],
        risks: [],
        open_questions: [],
        quality_result: { passed: true, notes: "ok" },
      },
    ],
    knowledgeGraph: graph,
  });

  assert.deepEqual(report.rejected_task_ids, ["task-01"]);
  assert.equal(
    report.executor_update_records[0]?.commit_status,
    "committed",
  );
  assert.equal(report.issues[0]?.code, "INVALID_RELATION_DIRECTION");
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
    type: "References",
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
    createTask("task-02", 2, "executor-market-research"),
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

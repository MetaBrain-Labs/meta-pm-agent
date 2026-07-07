/**
 * Product workflow DAG 调度测试
 *
 * 验证 Planner Agent 产出的任务 DAG 可以按依赖关系推导并行 Executor 批次，
 * 同时避免同一个 Executor 节点在同一批次内被重复调度。
 *
 * Responsibilities:
 * - 验证无依赖任务会被放入同一并行批次
 * - 验证下游任务只在依赖任务完成后进入批次
 * - 验证同一 Executor 的多个 ready 任务按最早 sequence 串行执行
 *
 * Notes:
 * - 该测试只覆盖调度选择逻辑，不调用模型或 Executor Agent。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CritiqueAgentOutputSchema,
  TaskExecutionPlanSchema,
  type ProductKnowledgeGraph,
  type RequestAnalysis,
  ExecutorAgentResult,
  ProductWorkflowResult,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import {
  createFallbackPlan,
  normalizeTaskExecutionPlan,
} from "../src/agents/product-workflow/planner-agent/agent";
import { selectNextExecutorRouterTargets } from "../src/graph/nodes/product-workflow-node";
import type { WorkflowGraphStateValue } from "../src/graph/state";

test("selects all ready executors for the next parallel batch", () => {
  const state = createState({
    tasks: [
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-toolkit", []),
      createTask("task-03", 3, "executor-product-discovery", ["task-01"]),
    ],
  });

  assert.deepEqual(selectNextExecutorRouterTargets(state), [
    "executor-product-strategy",
    "executor-toolkit",
  ]);
});

test("waits for dependencies before selecting downstream executor", () => {
  const state = createState({
    tasks: [
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-toolkit", []),
      createTask("task-03", 3, "executor-product-discovery", ["task-01"]),
    ],
    results: [
      createResult("task-01", "executor-product-strategy"),
      createResult("task-02", "executor-toolkit"),
    ],
  });

  assert.deepEqual(selectNextExecutorRouterTargets(state), [
    "executor-product-discovery",
  ]);
});

test("keeps multiple ready tasks for one executor in separate batches", () => {
  const state = createState({
    tasks: [
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-strategy", []),
      createTask("task-03", 3, "executor-market-research", []),
    ],
  });

  assert.deepEqual(selectNextExecutorRouterTargets(state), [
    "executor-product-strategy",
    "executor-market-research",
  ]);
});

test("normalizes waterfall planner DAG into parallel-ready layers", () => {
  const plan = normalizeTaskExecutionPlan(
    createPlan([
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
      createTask("task-03", 3, "executor-product-execution", ["task-02"]),
      createTask("task-04", 4, "executor-data-analytics", ["task-03"]),
      createTask("task-05", 5, "executor-ai-shipping", ["task-04"]),
      createTask("task-06", 6, "executor-toolkit", ["task-05"]),
      createTask("task-07", 7, "executor-interface-craft", ["task-06"]),
    ]),
  );

  assert.deepEqual(
    plan.tasks.map((task) => [task.task_id, task.depends_on]),
    [
      ["task-01", []],
      ["task-02", ["task-01"]],
      ["task-03", ["task-02"]],
      ["task-04", ["task-01"]],
      ["task-05", ["task-03"]],
      ["task-06", []],
      ["task-07", ["task-03"]],
    ],
  );
  assert.deepEqual(plan.dag.edges, [
    { source: "task-01", target: "task-02" },
    { source: "task-02", target: "task-03" },
    { source: "task-01", target: "task-04" },
    { source: "task-03", target: "task-05" },
    { source: "task-03", target: "task-07" },
  ]);
});

test("parses planner DAG edge aliases from model output", () => {
  const result = TaskExecutionPlanSchema.safeParse({
    status: "initial",
    request_summary: "Design a collaborative document MVP.",
    dag: {
      nodes: ["task-01", "task-02"],
      edges: [{ from: "task-01", to: "task-02" }],
    },
    tasks: [
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
    ],
    assumptions: [],
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.dag.edges, [
    { source: "task-01", target: "task-02" },
  ]);
});

test("parses planner DAG edge arrays from model output", () => {
  const result = TaskExecutionPlanSchema.safeParse({
    status: "initial",
    request_summary: "Design a collaborative document MVP.",
    dag: [{ from: "task-01", to: "task-02" }],
    tasks: [
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
    ],
    assumptions: [],
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.dag.nodes, []);
  assert.deepEqual(result.data.dag.edges, [
    { source: "task-01", target: "task-02" },
  ]);
});

test("normalizes critique agent issue severity and note shapes", () => {
  const result = CritiqueAgentOutputSchema.safeParse({
    status: "pending_user_confirmation",
    confirmation_id: "product-workflow-confirmation",
    request_summary: "Review a product workflow.",
    review: {
      accepted_task_ids: [],
      rejected_task_ids: ["task-01"],
      retry_task_ids: ["task-01"],
      issues: [
        {
          code: "NO_STRUCTURED_GRAPH_PATCH",
          task_id: "task-01",
          message: "Executor result contains no structured graph patch items.",
        },
      ],
      notes: ["Task task-01 needs correction."],
    },
    product_context_update: "Task task-01 needs correction.",
    knowledge_graph_review: {
      graph_ref: "runtime-graph-snapshot",
      accepted_task_ids: [],
      rejected_task_ids: ["task-01"],
      retry_task_ids: ["task-01"],
      issues: [
        {
          code: "NO_STRUCTURED_GRAPH_PATCH",
          task_id: "task-01",
          message: "Executor result contains no structured graph patch items.",
        },
      ],
      notes: "Task task-01 needs correction.",
    },
    proposal_questions: [],
    confirmation_message: "Please confirm correction.",
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.review.issues[0]?.severity, "error");
  assert.equal(result.data.knowledge_graph_review.issues[0]?.severity, "error");
  assert.deepEqual(result.data.knowledge_graph_review.graph_ref, {
    checksum: "runtime-graph-snapshot",
  });
  assert.match(result.data.review.notes, /task-01/);
  assert.deepEqual(result.data.knowledge_graph_review.notes, [
    "Task task-01 needs correction.",
  ]);
});

test("normalizes structured planner assumptions without replacing the plan", () => {
  const result = TaskExecutionPlanSchema.safeParse({
    status: "initial",
    request_summary:
      "先讨论产品方向，后续再确定具体产出。",
    dag: {
      nodes: ["task-1", "task-2"],
      edges: [],
    },
    tasks: [
      createTask("task-1", 1, "executor-product-strategy", []),
      createTask("task-2", 2, "executor-toolkit", []),
    ],
    assumptions: [
      {
        gap_ref: "missing_information[1] - 目标平台",
        assumption: "默认假设为 Web 优先平台，后续需要用户确认。",
        impact: "影响前端技术栈和编辑器渲染方案。",
      },
      {
        gap_ref: "user_input[5] - 先讨论产品方向",
        assumption:
          "当前 DAG 只讨论战略层和开放问题，不进入执行层产出。",
        impact: "不调度 Discovery、Execution、AI Shipping 或 Interface Craft。",
      },
    ],
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.dag.nodes, ["task-1", "task-2"]);
  assert.equal(result.data.tasks.length, 2);
  assert.deepEqual(
    result.data.tasks.map((task) => task.assigned_agent),
    ["executor-product-strategy", "executor-toolkit"],
  );
  assert.match(
    result.data.assumptions[0],
    /Gap: missing_information\[1\] - 目标平台/,
  );
  assert.match(
    result.data.assumptions[1],
    /不调度 Discovery、Execution、AI Shipping 或 Interface Craft/,
  );
});

test("normalizes compact planner quality checks without replacing the plan", () => {
  const result = TaskExecutionPlanSchema.safeParse({
    status: "initial",
    request_summary: "Design a collaborative document tool.",
    dag: {
      nodes: ["task-1", "task-2"],
      edges: [],
    },
    tasks: [
      {
        ...createTask("task-1", 1, "executor-product-strategy", []),
        quality_check: {
          criteria: [
            "Goal covers must-have features",
            "Decision candidates stay unconfirmed",
          ],
        },
      },
      {
        ...createTask("task-2", 2, "executor-toolkit", []),
        quality_check: [
          "Use only allowed entity types",
          "Keep traceable relations",
        ],
      },
    ],
    assumptions: [],
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.tasks[0].quality_check.status, "pending");
  assert.deepEqual(result.data.tasks[0].quality_check.criteria, [
    "Goal covers must-have features",
    "Decision candidates stay unconfirmed",
  ]);
  assert.deepEqual(result.data.tasks[1].quality_check, {
    status: "pending",
    criteria: ["Use only allowed entity types", "Keep traceable relations"],
  });
});

test("creates parallel graph-operation fallback plan for broad MVP requests", () => {
  const plan = createFallbackPlan(
    {
      productContext: "Workspace: local test",
      knowledgeGraph: createEmptyKnowledgeGraph(),
      requestAnalysis: createCollaborativeDocumentRequestAnalysis(),
      userInput: [
        {
          index: 1,
          content:
            "Design an MVP for a real-time collaborative document editing tool for 5-20 person teams, Web browser first.",
          type: "request",
        },
      ],
    },
    "schema-validation: dag.edges.0.source missing",
  );

  assert.ok(plan.tasks.length >= 5);
  assert.deepEqual(
    plan.tasks.map((task) => task.assigned_agent),
    [
      "executor-product-strategy",
      "executor-toolkit",
      "executor-market-research",
      "executor-product-discovery",
      "executor-product-execution",
      "executor-ai-shipping",
    ],
  );
  assert.deepEqual(
    plan.tasks
      .filter((task) => task.depends_on.length === 0)
      .map((task) => task.assigned_agent),
    ["executor-product-strategy"],
  );
  assert.deepEqual(
    plan.dag.edges.map((edge) => [edge.source, edge.target]),
    [
      ["task-01", "task-02"],
      ["task-01", "task-03"],
      ["task-01", "task-04"],
      ["task-04", "task-05"],
      ["task-05", "task-06"],
    ],
  );
  assert.notEqual(
    plan.tasks[0].covered_business_model_indexes,
    plan.tasks[1].covered_business_model_indexes,
  );

  const strategyTask = plan.tasks.find(
    (task) => task.assigned_agent === "executor-product-strategy",
  );
  const shippingTask = plan.tasks.find(
    (task) => task.assigned_agent === "executor-ai-shipping",
  );

  assert.ok(strategyTask);
  assert.match(strategyTask.description, /decision candidates/i);
  assert.match(strategyTask.description, /do not convert unknown/i);
  assert.ok(shippingTask);
  assert.match(shippingTask.description, /compare technical option families/i);
  assert.doesNotMatch(shippingTask.description, /CRDT vs OT/i);
  assert.doesNotMatch(shippingTask.description, /selected CRDT/i);
  assert.equal(
    plan.tasks.filter(
      (task) => task.assigned_agent === "executor-product-strategy",
    ).length,
    1,
  );
  assertNoDagCycle(plan);
  assert.ok(
    plan.tasks.every((task) =>
      task.quality_check.criteria.some((criterion) =>
        criterion.includes("explicit relation directions"),
      ),
    ),
  );
  assert.ok(
    plan.tasks.every((task) => task.quality_check.criteria.length <= 4),
  );
});

test("keeps document approval fallback focused and acyclic", () => {
  const plan = createFallbackPlan(
    {
      productContext: "Workspace: local test",
      knowledgeGraph: createEmptyKnowledgeGraph(),
      requestAnalysis: createApprovalDocumentRequestAnalysis(),
      userInput: [
        {
          index: 1,
          content:
            "从零开始设计一个全新的文档协同工具，面向中型企业，支持多人同时编辑同一文档和文档审批流转，优先在Web端实现。",
          type: "request",
        },
      ],
    },
    "schema-validation: dag: Expected object, received array",
  );

  assert.deepEqual(
    plan.tasks.map((task) => task.assigned_agent),
    [
      "executor-product-strategy",
      "executor-toolkit",
      "executor-market-research",
      "executor-product-discovery",
      "executor-product-execution",
      "executor-ai-shipping",
    ],
  );
  assert.equal(
    plan.tasks.some((task) => task.assigned_agent === "executor-data-analytics"),
    false,
  );
  assert.equal(
    plan.tasks.some((task) => task.assigned_agent === "executor-interface-craft"),
    false,
  );
  assert.equal(
    plan.tasks.filter(
      (task) => task.assigned_agent === "executor-product-strategy",
    ).length,
    1,
  );
  assertNoDagCycle(plan);
  assert.ok(
    plan.assumptions.some((assumption) =>
      assumption.includes("Unresolved request gaps"),
    ),
  );
});

test("keeps strategy refinement dependencies downstream only", () => {
  const plan = normalizeTaskExecutionPlan(
    createPlan([
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
      createTask("task-03", 3, "executor-product-execution", ["task-02"]),
      createTask("task-04", 4, "executor-ai-shipping", ["task-03"]),
      createTask("task-05", 5, "executor-product-strategy", [
        "task-01",
        "task-03",
        "task-04",
      ]),
    ]),
  );

  assert.deepEqual(
    plan.tasks.map((task) => [task.task_id, task.depends_on]),
    [
      ["task-01", []],
      ["task-02", ["task-01"]],
      ["task-03", ["task-02"]],
      ["task-04", ["task-03"]],
      ["task-05", ["task-01", "task-03", "task-04"]],
    ],
  );
  assertNoDagCycle(plan);
});

test("keeps concept-stage fallback focused on strategy, discovery, research, and toolkit", () => {
  const plan = createFallbackPlan(
    {
      productContext: "Workspace: local test",
      knowledgeGraph: createEmptyKnowledgeGraph(),
      requestAnalysis: createConceptStageDocumentRequestAnalysis(),
      userInput: [
        {
          index: 1,
          content:
            "设计一个 Web 文档协同工具，当前聚焦在产品概念与功能设计阶段，后续再确定具体产出。",
          type: "request",
        },
      ],
    },
    "schema-validation: quality_check missing status",
  );

  assert.deepEqual(
    plan.tasks.map((task) => task.assigned_agent),
    [
      "executor-product-strategy",
      "executor-toolkit",
      "executor-market-research",
      "executor-product-discovery",
    ],
  );
  assert.deepEqual(plan.tasks[1].depends_on, ["task-01"]);
  assert.ok(
    plan.tasks.every((task) => task.quality_check.criteria.length <= 4),
  );
  assert.ok(plan.tasks.every((task) => task.description.length < 500));
});

test("selects normalized planner roots and downstream parallel batches", () => {
  const plan = normalizeTaskExecutionPlan(
    createPlan([
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
      createTask("task-03", 3, "executor-product-execution", ["task-02"]),
      createTask("task-04", 4, "executor-data-analytics", ["task-03"]),
      createTask("task-05", 5, "executor-ai-shipping", ["task-04"]),
      createTask("task-06", 6, "executor-toolkit", ["task-05"]),
      createTask("task-07", 7, "executor-interface-craft", ["task-06"]),
    ]),
  );

  assert.deepEqual(
    selectNextExecutorRouterTargets(createState({ tasks: plan.tasks })),
    ["executor-product-strategy", "executor-toolkit"],
  );
  assert.deepEqual(
    selectNextExecutorRouterTargets(
      createState({
        tasks: plan.tasks,
        results: [
          createResult("task-01", "executor-product-strategy"),
          createResult("task-06", "executor-toolkit"),
        ],
      }),
    ),
    ["executor-product-discovery", "executor-data-analytics"],
  );
  assert.deepEqual(
    selectNextExecutorRouterTargets(
      createState({
        tasks: plan.tasks,
        results: [
          createResult("task-01", "executor-product-strategy"),
          createResult("task-02", "executor-product-discovery"),
          createResult("task-03", "executor-product-execution"),
          createResult("task-04", "executor-data-analytics"),
          createResult("task-06", "executor-toolkit"),
        ],
      }),
    ),
    ["executor-ai-shipping", "executor-interface-craft"],
  );
});

test("routes completed executor DAG back to orchestrator review", () => {
  const tasks = [
    createTask("task-01", 1, "executor-product-strategy", []),
    createTask("task-02", 2, "executor-toolkit", ["task-01"]),
  ];
  const state = createState({
    tasks,
    results: [
      createResult("task-01", "executor-product-strategy"),
      createResult("task-02", "executor-toolkit"),
    ],
  });

  assert.equal(selectNextExecutorRouterTargets(state), "orchestrator_agent");
});

test("routes to end after planner review has produced the workflow result", () => {
  const state = createState({
    tasks: [createTask("task-01", 1, "executor-product-strategy", [])],
    productWorkflow: {} as ProductWorkflowResult,
  });

  assert.equal(selectNextExecutorRouterTargets(state), "end");
});

function createState({
  tasks,
  results = [],
  productWorkflow = null,
}: {
  tasks: TaskExecutionNode[];
  results?: ExecutorAgentResult[];
  productWorkflow?: ProductWorkflowResult | null;
}): WorkflowGraphStateValue {
  return {
    productWorkflow,
    plan: createPlan(tasks),
    executorResults: results,
  } as WorkflowGraphStateValue;
}

function createPlan(tasks: TaskExecutionNode[]): TaskExecutionPlan {
  return {
    status: "initial",
    request_summary: "Test request",
    dag: {
      nodes: tasks.map((task) => task.task_id),
      edges: tasks.flatMap((task) =>
        task.depends_on.map((dependency) => ({
          source: dependency,
          target: task.task_id,
        })),
      ),
    },
    tasks,
    assumptions: [],
  };
}

/**
 * 验证测试计划没有形成循环依赖，覆盖 Planner DAG 归一化的关键业务约束。
 */
function assertNoDagCycle(plan: TaskExecutionPlan): void {
  const incomingCount = new Map(plan.dag.nodes.map((node) => [node, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of plan.dag.edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const queue = [...incomingCount.entries()].flatMap(([node, count]) =>
    count === 0 ? [node] : [],
  );
  const visited: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    visited.push(node);

    for (const target of outgoing.get(node) ?? []) {
      const nextCount = (incomingCount.get(target) ?? 0) - 1;
      incomingCount.set(target, nextCount);
      if (nextCount === 0) queue.push(target);
    }
  }

  assert.equal(visited.length, plan.dag.nodes.length);
}

function createTask(
  taskId: string,
  sequence: number,
  assignedAgent: TaskExecutionNode["assigned_agent"],
  dependsOn: string[],
): TaskExecutionNode {
  return {
    task_id: taskId,
    sequence,
    title: taskId,
    description: `${taskId} description`,
    assigned_agent: assignedAgent,
    depends_on: dependsOn,
    covered_business_model_indexes: [1],
    expected_output: `${taskId} output`,
    quality_check: {
      status: "pending",
      criteria: ["Must update graph"],
    },
  };
}

function createResult(
  taskId: string,
  agentType: ExecutorAgentResult["agent_type"],
): ExecutorAgentResult {
  return {
    task_id: taskId,
    agent_type: agentType,
    focus_layer: "Goal",
    summary: `${taskId} summary`,
    entities: [],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: {
      passed: true,
      notes: "ok",
    },
  };
}

function createCollaborativeDocumentRequestAnalysis(): RequestAnalysis {
  return {
    business_model: [
      {
        index: 1,
        user_goal:
          "Design an MVP for a real-time collaborative document editing tool.",
        goal_constraints: [
          "Supports multi-user real-time editing similar to Google Docs.",
          "Targets internal use by small teams of 5-20 people.",
          "Prioritizes Web browser support.",
        ],
        missing_information: [
          {
            index: 1,
            description:
              "Document format types required for MVP, such as plain text, rich text, or spreadsheets.",
            importance: 0.7,
          },
          {
            index: 2,
            description:
              "Permission and security requirements for collaborative editing.",
            importance: 0.6,
          },
        ],
        covered_user_input_indexes: [1],
      },
    ],
    questions: [],
    chitchat: [],
  };
}

function createApprovalDocumentRequestAnalysis(): RequestAnalysis {
  return {
    business_model: [
      {
        index: 1,
        user_goal:
          "从零开始设计一个全新的文档协同工具，面向中型企业（16-200人），支持多人同时编辑同一文档和文档审批流转，优先在Web端实现。",
        goal_constraints: [
          "面向中型企业团队使用",
          "支持多人同时编辑同一文档",
          "支持文档审批流转",
          "优先在 Web 端实现",
        ],
        missing_information: [
          {
            index: 1,
            description: "文档数据安全和权限管理的具体要求",
            importance: 0.9,
          },
          {
            index: 2,
            description: "是否需要支持离线编辑或移动端",
            importance: 0.7,
          },
          {
            index: 3,
            description: "期望支持的文档格式范围（纯文本、表格、演示文稿等）",
            importance: 0.8,
          },
        ],
        covered_user_input_indexes: [1],
      },
    ],
    questions: [],
    chitchat: [],
  };
}

function createConceptStageDocumentRequestAnalysis(): RequestAnalysis {
  return {
    business_model: [
      {
        index: 1,
        user_goal:
          "设计一个文档协同工具，让团队能实时共同编辑产品需求文档并追踪变更历史",
        goal_constraints: [
          "目标用户为企业内部团队",
          "当前聚焦在产品概念与功能设计阶段",
          "首选平台为 Web 端",
          "必须具备多人实时协同编辑、评论批注、权限与角色管理",
        ],
        missing_information: [
          {
            index: 1,
            description: "预期用户规模与并发编辑量级，以确定技术架构选型",
            importance: 0.9,
          },
          {
            index: 2,
            description: "是否需要与企业现有系统如 SSO 或项目管理工具集成",
            importance: 0.8,
          },
        ],
        covered_user_input_indexes: [1],
      },
    ],
    questions: [],
    chitchat: [],
  };
}

function createEmptyKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    entities: [],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    markdown: "",
    notes: [],
  };
}

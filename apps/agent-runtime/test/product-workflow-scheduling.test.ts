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
 * - 验证表单恢复在没有指定 Executor 时仍被识别为 supplement
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
} from "../src/agents/product-workflow/orchestrator-agent/planner-subagent/plan";
import {
  extractPlanFromSubagentResult,
  removeAnsweredOpenQuestions,
  scopeInitialDecisionPlan,
  scopeSupplementPlan,
} from "../src/agents/product-workflow/orchestrator-agent/planner-subagent/agent";
import {
  compactGraphForPlanner,
  createPlannerDelegationSummary,
  requireDelegatedPlannerPlan,
  shouldRetryPlannerDelegation,
} from "../src/agents/product-workflow/orchestrator-agent/agent";
import { getMissingRequiredSubagentError } from "../src/agents/common/run-agent";
import {
  createAutomaticCorrectionUserInput,
  createWorkflowRoundStartEvent,
  isSupplementWorkflow,
  requireMissingInputConfirmation,
  selectNextExecutorRouterTargets,
  shouldAutomaticallyPlanCorrection,
} from "../src/graph/nodes/product-workflow-node";
import type { WorkflowGraphStateValue } from "../src/graph/state";

test("automatically replans one retry-only Critique result", () => {
  const result = {
    review: { retry_task_ids: ["supplement-task-01"] },
    proposal_questions: [],
    knowledge_graph_update: { open_questions: [] },
  } as unknown as ProductWorkflowResult;

  assert.equal(
    shouldAutomaticallyPlanCorrection(result, { userInput: [] }),
    true,
  );
  assert.equal(
    shouldAutomaticallyPlanCorrection(result, {
      userInput: [
        {
          index: 1,
          type: "自动审查修正",
          content: "[automatic critique correction]",
        },
      ],
    }),
    false,
  );
});

test("assigns a distinct round ID to each new Planner DAG", () => {
  const first = createWorkflowRoundStartEvent();
  const second = createWorkflowRoundStartEvent();

  assert.equal(first.type, "workflow-round-start");
  assert.notEqual(first.roundId, second.roundId);
});

test("automatic Critique correction preserves original input indexes and meaning", () => {
  const workflow = createRetryWorkflowResult();
  const correctedInput = createAutomaticCorrectionUserInput(
    workflow,
    [
      { index: 1, type: "request", content: "设计文档协同工具" },
      {
        index: 5,
        type: "constraint",
        content: "无特殊技术或平台约束",
      },
    ],
    [
      {
        index: 1,
        type: "form",
        content: "[form answers - proposal] 保持当前范围",
      },
    ],
  );

  assert.equal(correctedInput[1]?.index, 5);
  assert.equal(correctedInput[1]?.content, "无特殊技术或平台约束");
  assert.equal(correctedInput[2]?.index, 6);
  assert.equal(correctedInput[3]?.index, 7);
  assert.match(correctedInput[3]?.content ?? "", /automatic critique correction/);
});

test("missing referenced input asks for confirmation instead of automatic planning", () => {
  const workflow = createRetryWorkflowResult();
  workflow.review.issues = [
    {
      code: "UNCOVERED_USER_INPUT",
      severity: "error",
      task_id: "task-01",
      message:
        "Explicit user input 5 is not represented by an active Requirement.",
    },
  ];

  const guarded = requireMissingInputConfirmation(workflow, []);

  assert.equal(guarded.status, "pending_user_confirmation");
  assert.equal(guarded.proposal_questions[0]?.source_task_id, "task-01");
  assert.match(guarded.proposal_questions[0]?.label ?? "", /5/);
  assert.equal(
    shouldAutomaticallyPlanCorrection(guarded, { userInput: [] }),
    false,
  );
});

test("removes answered open questions from supplement tasks only", () => {
  const supplement = createPlan([
    {
      ...createTask("task-01", 1, "executor-product-strategy", []),
      required_open_question_ids: ["OQ-ANSWERED", "OQ-NEW"],
    },
  ]);
  supplement.status = "supplement";

  const normalized = removeAnsweredOpenQuestions(supplement, ["OQ-ANSWERED"]);

  assert.deepEqual(normalized.tasks[0]?.required_open_question_ids, ["OQ-NEW"]);
});

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

test("recognizes form-answer workflows as supplements without agent hints", () => {
  const state = {
    supplementAgentTypes: [],
    userInput: [
      {
        index: 1,
        type: "form",
        content: "[form answers - proposal-decision] confirmed",
      },
    ],
  } as unknown as WorkflowGraphStateValue;

  assert.equal(isSupplementWorkflow(state), true);
});

test("limits supplement Planner context and preserves tracked questions", () => {
  const graph = createEmptyKnowledgeGraph();
  graph.entities = Array.from({ length: 30 }, (_, index) => ({
    id: index === 0 ? "G-001" : `R-${String(index).padStart(3, "0")}`,
    type: index === 0 ? ("Goal" as const) : ("Requirement" as const),
    name: `Node ${index}`,
    source_task_id: "task-01",
    status: "proposed" as const,
  }));
  graph.open_questions = [
    {
      id: "OQ-001",
      text: "Which launch date is authoritative?",
      blocking: true,
      source_task_id: "task-01",
    },
  ];

  const compact = compactGraphForPlanner(graph, true);

  assert.ok(compact.entities.length <= 40);
  assert.deepEqual(compact.open_questions, [
    {
      id: "OQ-001",
      text: "Which launch date is authoritative?",
      blocking: true,
      source_task_id: "task-01",
    },
  ]);
});

test("supplement Planner context includes affected neighbor descriptions", () => {
  const graph = createEmptyKnowledgeGraph();
  graph.entities = [
    {
      id: "R-001",
      type: "Requirement",
      name: "SM4 encryption",
      description: "The confirmed encryption requirement uses SM4.",
      source_task_id: "task-strategy",
      status: "confirmed",
    },
    {
      id: "C-001",
      type: "Custom",
      name: "Legacy encryption guardrail",
      description: "Use AES-256 for data encryption.",
      source_task_id: "task-toolkit",
      status: "confirmed",
    },
  ];
  graph.relations = [
    {
      id: "REL-001",
      type: "Constrains",
      source: "C-001",
      target: "R-001",
      source_task_id: "task-toolkit",
    },
  ];

  const compact = compactGraphForPlanner(
    graph,
    true,
    ["task-strategy"],
    ["task-strategy", "task-toolkit"],
  );

  assert.equal(
    compact.entities.find((entity) => entity.id === "C-001")?.description,
    "Use AES-256 for data encryption.",
  );
  assert.equal(compact.relations[0]?.description, undefined);
});

test("fails when Orchestrator does not actually delegate to Planner", () => {
  assert.equal(
    getMissingRequiredSubagentError("planner", new Set()),
    "required-subagent-not-invoked: planner",
  );
  assert.equal(
    getMissingRequiredSubagentError("planner", new Set(["planner"])),
    null,
  );
  assert.throws(
    () => requireDelegatedPlannerPlan("product_workflow", undefined, false),
    /Orchestrator 未调用 Planner Subagent/,
  );
  assert.throws(
    () => requireDelegatedPlannerPlan("product_workflow", undefined, true),
    /Planner Subagent 已调用，但未返回可用计划/,
  );
  assert.equal(
    requireDelegatedPlannerPlan("conversation", undefined, false),
    undefined,
  );
  assert.equal(
    shouldRetryPlannerDelegation(
      new Error("required-subagent-not-invoked: planner"),
      1,
    ),
    true,
  );
  assert.equal(
    shouldRetryPlannerDelegation(
      new Error("required-subagent-not-invoked: planner"),
      2,
    ),
    false,
  );
  assert.equal(
    shouldRetryPlannerDelegation(new Error("provider unavailable"), 1),
    false,
  );
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

test("preserves explicit planner data dependencies", () => {
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
      ["task-04", ["task-03"]],
      ["task-05", ["task-04"]],
      ["task-06", ["task-05"]],
      ["task-07", ["task-06"]],
    ],
  );
  assert.deepEqual(plan.dag.edges, [
    { source: "task-01", target: "task-02" },
    { source: "task-02", target: "task-03" },
    { source: "task-03", target: "task-04" },
    { source: "task-04", target: "task-05" },
    { source: "task-05", target: "task-06" },
    { source: "task-06", target: "task-07" },
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
    ],
  );
  assert.equal(plan.tasks[0]?.required_open_question_count, 2);
  assert.equal(
    plan.tasks.slice(1).every(
      (task) => task.required_open_question_count === 0,
    ),
    true,
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
    ],
  );
  assert.notEqual(
    plan.tasks[0].covered_business_model_indexes,
    plan.tasks[1].covered_business_model_indexes,
  );

  const strategyTask = plan.tasks.find(
    (task) => task.assigned_agent === "executor-product-strategy",
  );
  const executionTask = plan.tasks.find(
    (task) => task.assigned_agent === "executor-product-execution",
  );

  assert.ok(strategyTask);
  assert.match(strategyTask.description, /decision candidates/i);
  assert.match(strategyTask.description, /do not convert unknown/i);
  assert.ok(executionTask);
  assert.match(executionTask.expected_output, /Minimum MVP Component breakdown/i);
  assert.match(executionTask.expected_output, /acceptance Requirements or Metrics/i);
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

test("creates a scoped fallback DAG for dynamic confirmation answers", () => {
  const plan = createFallbackPlan(
    {
      productContext: "Workspace: local test",
      knowledgeGraph: createEmptyKnowledgeGraph(),
      requestAnalysis: createCollaborativeDocumentRequestAnalysis(),
      userInput: [
        {
          index: 1,
          content:
            "[form answers - critique-result-001]\n- Sync: Last-Write-Wins\n- Concurrent editors: Up to 10",
          type: "request",
        },
      ],
      supplementAgentTypes: [
        "executor-product-strategy",
        "executor-data-analytics",
        "executor-ai-shipping",
      ],
    },
    "Planner subagent tool call failed schema validation",
  );

  assert.equal(plan.status, "supplement");
  assert.deepEqual(
    plan.tasks.map((task) => task.assigned_agent),
    [
      "executor-product-strategy",
      "executor-data-analytics",
      "executor-ai-shipping",
    ],
  );
  assert.ok(
    plan.tasks.every((task) => task.task_id.startsWith("supplement-task-")),
  );
  assert.ok(
    plan.tasks.every((task) =>
      task.description.includes("do not repeat the baseline DAG"),
    ),
  );
  assertNoDagCycle(plan);
});

test("scopes a model-generated supplement plan to authorized agents", () => {
  const scoped = scopeSupplementPlan(
    createPlan([
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
      createTask("task-03", 3, "executor-data-analytics", ["task-02"]),
      createTask("task-04", 4, "executor-ai-shipping", ["task-03"]),
    ]),
    ["executor-product-strategy", "executor-data-analytics"],
  );

  assert.equal(scoped.status, "supplement");
  assert.deepEqual(
    scoped.tasks.map((task) => [
      task.task_id,
      task.assigned_agent,
      task.depends_on,
    ]),
    [
      ["supplement-task-01", "executor-product-strategy", []],
      ["supplement-task-02", "executor-data-analytics", []],
    ],
  );
  assert.deepEqual(scoped.dag.nodes, [
    "supplement-task-01",
    "supplement-task-02",
  ]);
});

test("keeps minimum MVP execution while deferring detailed technical work", () => {
  const scoped = scopeInitialDecisionPlan(
    createPlan([
      createTask("task-01", 1, "executor-product-strategy", []),
      createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
      createTask("task-03", 3, "executor-product-execution", ["task-02"]),
      createTask("task-04", 4, "executor-ai-shipping", ["task-03"]),
    ]),
    {
      productContext: "Workspace: local test",
      knowledgeGraph: createEmptyKnowledgeGraph(),
      requestAnalysis: createCollaborativeDocumentRequestAnalysis(),
      userInput: [{ index: 1, content: "Design the MVP", type: "request" }],
    },
  );

  assert.deepEqual(
    scoped.tasks.map((task) => [task.task_id, task.depends_on]),
    [
      ["task-01", []],
      ["task-02", ["task-01"]],
      ["task-03", ["task-02"]],
    ],
  );
  const summary = createPlannerDelegationSummary(scoped);
  assert.match(summary, /with 3 tasks/);
  assert.match(summary, /task-03/);
  assert.doesNotMatch(summary, /task-04/);
});

test("replaces an under-scoped broad model plan with evidence and MVP coverage", () => {
  const result = extractPlanFromSubagentResult(
    JSON.stringify(
      createPlan([
        createTask("task-01", 1, "executor-product-strategy", []),
        createTask("task-02", 2, "executor-product-discovery", ["task-01"]),
      ]),
    ),
    {
      productContext: "Workspace: local test",
      knowledgeGraph: createEmptyKnowledgeGraph(),
      requestAnalysis: createCollaborativeDocumentRequestAnalysis(),
      userInput: [{ index: 1, content: "Design the MVP", type: "request" }],
    },
  );

  assert.ok(
    result.tasks.some(
      (task) => task.assigned_agent === "executor-market-research",
    ),
  );
  assert.ok(
    result.tasks.some(
      (task) => task.assigned_agent === "executor-product-execution",
    ),
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

test("keeps concept-stage fallback focused and labels the limited outcome", () => {
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
      "executor-product-discovery",
    ],
  );
  assert.deepEqual(plan.tasks[1].depends_on, ["task-01"]);
  assert.ok(
    plan.tasks.every((task) => task.quality_check.criteria.length <= 4),
  );
  assert.ok(plan.tasks.every((task) => task.description.length < 500));
  assert.match(plan.request_summary, /Concept foundation only/);
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
    ["executor-product-strategy"],
  );
  assert.deepEqual(
    selectNextExecutorRouterTargets(
      createState({
        tasks: plan.tasks,
        results: [createResult("task-01", "executor-product-strategy")],
      }),
    ),
    ["executor-product-discovery"],
  );
  assert.deepEqual(
    selectNextExecutorRouterTargets(
      createState({
        tasks: plan.tasks,
        results: [
          createResult("task-01", "executor-product-strategy"),
          createResult("task-02", "executor-product-discovery"),
          createResult("task-03", "executor-product-execution"),
        ],
      }),
    ),
    ["executor-data-analytics"],
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

/**
 * 构造会触发自动补充规划的最小 Critique 结果。
 */
function createRetryWorkflowResult(): ProductWorkflowResult {
  const planner = createPlan([
    createTask("task-01", 1, "executor-product-strategy", []),
  ]);
  return {
    status: "pending_user_confirmation",
    confirmation_id: "critique-retry",
    request_summary: "Correct uncovered input.",
    planner,
    executor_results: [],
    review: {
      accepted_task_ids: [],
      rejected_task_ids: ["task-01"],
      retry_task_ids: ["task-01"],
      issues: [],
      notes: "Correction required.",
    },
    product_context_update: "Correction required.",
    knowledge_graph_update: createEmptyKnowledgeGraph(),
    knowledge_graph_review: {
      accepted_task_ids: [],
      rejected_task_ids: ["task-01"],
      retry_task_ids: ["task-01"],
      issues: [],
      notes: ["Correction required."],
    },
    proposal_questions: [],
    confirmation_message: "Correction required.",
  };
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

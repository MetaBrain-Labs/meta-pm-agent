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
import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import { normalizeTaskExecutionPlan } from "../src/agents/product-workflow/planner-agent/agent";
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

test("routes completed executor DAG back to planner review", () => {
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

  assert.equal(selectNextExecutorRouterTargets(state), "planner_agent");
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

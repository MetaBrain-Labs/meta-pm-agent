/**
 * Planner DAG 历史结果归并测试
 *
 * 验证独立持久化的 Executor 结果只挂回最近一轮包含相同 task_id 的 Planner 消息。
 *
 * Responsibilities:
 * - 防止跨轮相同任务 ID 污染旧 DAG
 * - 验证刷新后的完成状态可由历史消息恢复
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
  TaskExecutionPlan,
} from "@repo/shared";
import {
  attachArchivedProductWorkflowDisplays,
  attachExecutorResultsToPlannerMessages,
  mapMessageRow,
  type MessageDto,
} from "../src/repositories/message-repository";
import { createProductWorkflowDisplaySnapshot } from "../src/utils/product-workflow";
import { parseTaskExecutionPlanPayload } from "../src/utils/task-execution";

test("restores the latest plan and lightweight Critique snapshot from message metadata", () => {
  const oldPlan = createPlan("task-01", "initial");
  const latestPlan = createPlan("supplement-task-01", "supplement");
  const workflow = createWorkflowResult(latestPlan);
  const snapshot = createProductWorkflowDisplaySnapshot(workflow);
  const content = [
    `<task-execution>${JSON.stringify(oldPlan)}</task-execution>`,
    `<task-execution>${JSON.stringify(latestPlan)}</task-execution>`,
    "Planner SubAgent 已完成产品工作流汇总，结构化结果已归档。",
  ].join("\n");

  assert.equal(
    parseTaskExecutionPlanPayload(content)?.tasks[0]?.task_id,
    "supplement-task-01",
  );

  const restored = mapMessageRow({
    id: "critique",
    role: "assistant",
    type: "critique",
    content,
    meta: { taskExecutionPlan: latestPlan, productWorkflow: snapshot },
    user_input: null,
    created_at: new Date("2026-07-25T10:23:48.000Z"),
  });

  assert.equal(restored.taskExecutionPlan?.status, "supplement");
  assert.equal(restored.productWorkflow?.confirmation_id, "critique-1");
  assert.equal(restored.productWorkflow?.knowledge_graph_update.entities.length, 0);
  assert.equal(restored.content.includes("<task-execution"), false);

  const legacy = attachArchivedProductWorkflowDisplays(
    [
      {
        id: "legacy-critique",
        role: "assistant",
        content: [
          "Planner SubAgent 已完成产品工作流汇总，结构化结果已归档。",
          "确认 ID：critique-1",
          "状态：pending_user_confirmation",
          "Executor 结果数：1",
        ].join("\n"),
        timestamp: "2026-07-25T10:23:48.000Z",
      },
    ],
    [snapshot],
  );
  assert.equal(legacy[0]?.productWorkflow?.confirmation_id, "critique-1");
  assert.equal(legacy[0]?.content, "");
});

test("attaches executor result to the nearest matching planner DAG", () => {
  const plan: TaskExecutionPlan = {
    status: "supplement",
    request_summary: "Refine strategy",
    dag: { nodes: ["supplement-task-01"], edges: [] },
    tasks: [
      {
        task_id: "supplement-task-01",
        sequence: 1,
        title: "Refine strategy",
        description: "Apply confirmed constraints.",
        assigned_agent: "executor-product-strategy",
        depends_on: [],
        covered_business_model_indexes: [1],
        expected_output: "Updated strategy graph",
        quality_check: { status: "pending", criteria: ["traceable"] },
      },
    ],
    assumptions: [],
  };
  const result: ExecutorAgentResult = {
    task_id: "supplement-task-01",
    agent_type: "executor-product-strategy",
    focus_layer: "Goal",
    summary: "completed",
    entities: [],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    quality_result: { passed: true, notes: "ok" },
  };
  const messages: MessageDto[] = [
    plannerMessage("planner-old", plan),
    plannerMessage("planner-new", plan),
    {
      id: "executor",
      role: "assistant",
      content: "",
      timestamp: "2026-07-24T12:53:55.000Z",
      executorResult: result,
    },
  ];

  const restored = attachExecutorResultsToPlannerMessages(messages);

  assert.equal(restored[0]?.executorResults, undefined);
  assert.equal(
    restored[1]?.executorResults?.[0]?.task_id,
    "supplement-task-01",
  );
});

/**
 * 构造带计划的持久化消息。
 */
function plannerMessage(
  id: string,
  taskExecutionPlan: TaskExecutionPlan,
): MessageDto {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: "2026-07-24T12:49:41.000Z",
    taskExecutionPlan,
  };
}

/**
 * 构造单任务计划。
 */
function createPlan(
  taskId: string,
  status: TaskExecutionPlan["status"],
): TaskExecutionPlan {
  return {
    status,
    request_summary: "Refine strategy",
    dag: { nodes: [taskId], edges: [] },
    tasks: [
      {
        task_id: taskId,
        sequence: 1,
        title: "Refine strategy",
        description: "Apply confirmed constraints.",
        assigned_agent: "executor-product-strategy",
        depends_on: [],
        covered_business_model_indexes: [1],
        expected_output: "Updated strategy graph",
        quality_check: { status: "pending", criteria: ["traceable"] },
      },
    ],
    assumptions: [],
  };
}

/**
 * 构造包含完整图谱的工作流结果，验证持久化快照会剥离重数据。
 */
function createWorkflowResult(
  planner: TaskExecutionPlan,
): ProductWorkflowResult {
  return {
    status: "pending_user_confirmation",
    confirmation_id: "critique-1",
    request_summary: "Review correction.",
    planner,
    executor_results: [],
    review: {
      accepted_task_ids: [],
      rejected_task_ids: ["supplement-task-01"],
      retry_task_ids: ["supplement-task-01"],
      notes: "Correction required.",
    },
    product_context_update: "Correction required.",
    knowledge_graph_update: {
      current_state: "refining",
      entities: [
        {
          id: "R-1",
          type: "Requirement",
          name: "Requirement",
          status: "proposed",
          source_task_id: "supplement-task-01",
          provenance: [{ kind: "user_input", user_input_index: 1 }],
        },
      ],
      relations: [],
      decisions: [],
      risks: [],
      open_questions: [],
      summary: [],
      markdown: "",
      notes: [],
    },
    knowledge_graph_review: {
      graph_ref: { entity_count: 1, relation_count: 0 },
      accepted_task_ids: [],
      rejected_task_ids: ["supplement-task-01"],
      retry_task_ids: ["supplement-task-01"],
      issues: [],
      notes: ["Correction required."],
    },
    proposal_questions: [],
    confirmation_message: "Correction required.",
  };
}

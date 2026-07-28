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
import type { ExecutorAgentResult, TaskExecutionPlan } from "@repo/shared";
import {
  attachExecutorResultsToPlannerMessages,
  type MessageDto,
} from "../src/repositories/message-repository";

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

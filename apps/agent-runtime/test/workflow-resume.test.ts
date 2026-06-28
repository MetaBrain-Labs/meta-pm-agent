/**
 * Workflow 恢复上下文测试
 *
 * 验证 HITL 表单答案可以从历史消息中恢复 Planner DAG、Request Analysis 和受影响
 * Executor 任务，确保后续运行能够复用上下文并只重跑必要任务。
 *
 * Responsibilities:
 * - 覆盖硬阻塞表单的任务定位
 * - 覆盖补充信息确认表单的 Executor open question 定位
 * - 验证历史结构化块可被恢复为 workflow resume context
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "@repo/shared";
import { createWorkflowResumeContextFromMessages } from "../src/agents/conversation/workflow-resume";

test("restores direct executor blocker context from history", () => {
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages("[form answers - executor-blocker-task-01]\n- resolution: use B2B scope"),
  });

  assert.equal(context?.requestAnalysis?.business_model[0]?.user_goal, "Build MVP");
  assert.equal(context?.plan?.tasks.length, 2);
  assert.deepEqual(context?.rerunTaskIds, ["task-01"]);
  assert.equal(context?.executorResults?.length, 2);
});

test("restores proposal context for executors with open questions", () => {
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages("[form answers - product-workflow-confirmation-proposal-decision]\n- Market scope?: enterprise"),
  });

  assert.deepEqual(context?.rerunTaskIds, ["task-01"]);
});

test("restores final confirmation context for executors with open questions", () => {
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages("[form answers - product-workflow-confirmation]\n- 你希望如何处理当前结果？: 确认接受\n- 补充说明: (skipped)"),
  });

  assert.deepEqual(context?.rerunTaskIds, ["task-01"]);
});

function createMessages(latestAnswer: string): ChatMessage[] {
  return [
    message("u1", "user", "Build MVP"),
    message(
      "a1",
      "assistant",
      `<request-analysis>\n${JSON.stringify({
        business_model: [
          {
            index: 1,
            user_goal: "Build MVP",
            goal_constraints: [],
            missing_information: [],
            covered_user_input_indexes: [1],
          },
        ],
        questions: [],
        chitchat: [],
      })}\n</request-analysis>`,
    ),
    message(
      "a2",
      "assistant",
      `<task-execution>\n${JSON.stringify({
        request_summary: "Build MVP",
        dag: {
          nodes: ["task-01", "task-02"],
          edges: [{ source: "task-01", target: "task-02" }],
        },
        tasks: [
          {
            task_id: "task-01",
            sequence: 1,
            title: "Strategy",
            description: "Clarify strategy",
            assigned_agent: "executor-product-strategy",
            depends_on: [],
            covered_business_model_indexes: [1],
            expected_output: "Strategy graph",
            quality_check: { status: "pending", criteria: ["traceable"] },
          },
          {
            task_id: "task-02",
            sequence: 2,
            title: "Execution",
            description: "Plan execution",
            assigned_agent: "executor-product-execution",
            depends_on: ["task-01"],
            covered_business_model_indexes: [1],
            expected_output: "Execution graph",
            quality_check: { status: "pending", criteria: ["traceable"] },
          },
        ],
        assumptions: [],
      })}\n</task-execution>`,
    ),
    message("a3", "assistant", createExecutorResultBlock("task-01", true)),
    message("a4", "assistant", createExecutorResultBlock("task-02", false)),
    message("u2", "user", latestAnswer),
  ];
}

function createExecutorResultBlock(taskId: string, hasOpenQuestion: boolean) {
  return `<executor-result>\n${JSON.stringify({
    task_id: taskId,
    agent_type:
      taskId === "task-01"
        ? "executor-product-strategy"
        : "executor-product-execution",
    focus_layer: "Goal",
    summary: `${taskId} summary`,
    entities: [],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: hasOpenQuestion
      ? [{ id: `${taskId}-oq`, text: "Market scope?" }]
      : [],
    quality_result: { passed: true, notes: "ok" },
  })}\n</executor-result>`;
}

function message(
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: "2026-06-27T00:00:00.000Z",
    sessionId: "test-session",
  };
}

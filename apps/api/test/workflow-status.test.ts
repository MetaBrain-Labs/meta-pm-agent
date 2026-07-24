/**
 * 产品工作流持久化状态测试
 *
 * 验证 Critique 要求修正但没有补充问题时，API 会持久化最终处理确认，
 * 已完成或仍有补充问题的结果不会误写该确认项。
 *
 * Responsibilities:
 * - 覆盖 retry 无 proposal 的确认持久化条件
 * - 覆盖 completed 与 proposal 分支
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ProductWorkflowResult } from "@repo/shared";
import { collectWorkflowAnswerResolution } from "../src/repositories/request-form-repository";
import { ChatRequestSchema } from "../src/schemas/request.schema";
import { shouldPersistProductWorkflowConfirmation } from "../src/services/chat-service";

test("persists final handling confirmation only for pending results without proposals", () => {
  const result = createWorkflowResult();

  assert.equal(shouldPersistProductWorkflowConfirmation(result), true);
  assert.equal(
    shouldPersistProductWorkflowConfirmation({ ...result, status: "completed" }),
    false,
  );
  assert.equal(
    shouldPersistProductWorkflowConfirmation({
      ...result,
      proposal_questions: [
        {
          id: "PQ-1",
          label: "Confirm scope?",
          type: "textarea",
          required: true,
          sources: [],
          priority: 100,
        },
      ],
    }),
    false,
  );
  result.knowledge_graph_update.open_questions = [
    {
      id: "OQ-1",
      text: "Confirm deployment?",
      source_task_id: "task-01",
      source_agent: "executor-product-strategy",
      blocking: true,
    },
  ];
  assert.equal(shouldPersistProductWorkflowConfirmation(result), false);
});

test("keeps exact question sources and only marks submitted fields answered", () => {
  const resolution = collectWorkflowAnswerResolution(
    {
      questions: [
        {
          id: "roles",
          question: "确认角色权限？",
          source_task_id: "task-01",
          source_agent: "executor-product-strategy",
          sources: [
            {
              source_task_id: "task-01",
              source_agent: "executor-product-strategy",
              open_question_id: "OQ-roles",
            },
          ],
        },
        {
          id: "deployment",
          question: "确认部署环境？",
          source_task_id: "task-01",
          source_agent: "executor-product-strategy",
          sources: [
            {
              source_task_id: "task-01",
              source_agent: "executor-product-strategy",
              open_question_id: "OQ-deployment",
            },
          ],
        },
      ],
    },
    {
      formId: "review-proposal-decision",
      content:
        "[form answers - review-proposal-decision]\n- 确认角色权限？: 管理员、编辑、只读\n- 确认部署环境？: (skipped)",
    },
  );

  assert.deepEqual(
    resolution.questions.map((question) => ({
      answered: question.answered,
      openQuestionId: question.sources[0]?.open_question_id,
    })),
    [
      { answered: true, openQuestionId: "OQ-roles" },
      { answered: false, openQuestionId: "OQ-deployment" },
    ],
  );
});

test("accepts executor retry separately from HITL resume", () => {
  const baseRequest = {
    chatId: "11111111-1111-4111-8111-111111111111",
    requestFormId: "22222222-2222-4222-8222-222222222222",
    messages: [
      {
        id: "message-1",
        role: "user" as const,
        content: "Build MVP",
        timestamp: "2026-07-24T00:00:00.000Z",
        sessionId: "test",
      },
    ],
  };
  const workflowRetry = {
    type: "resume_executor_task" as const,
    taskId: "task-06",
  };

  assert.equal(
    ChatRequestSchema.safeParse({ ...baseRequest, workflowRetry }).success,
    true,
  );
  assert.equal(
    ChatRequestSchema.safeParse({
      ...baseRequest,
      workflowRetry,
      hitlResume: {
        threadId: "hitl-thread",
        response: { decisions: [{ type: "approve" as const }] },
      },
    }).success,
    false,
  );
});

/**
 * 构造无需新增用户信息、但仍需确认处理方式的最小工作流结果。
 */
function createWorkflowResult(): ProductWorkflowResult {
  return {
    status: "pending_user_confirmation",
    confirmation_id: "review-1",
    request_summary: "Review correction.",
    planner: {
      status: "supplement",
      request_summary: "Review correction.",
      dag: { nodes: [], edges: [] },
      tasks: [],
      assumptions: [],
    },
    executor_results: [],
    review: {
      accepted_task_ids: [],
      rejected_task_ids: ["task-01"],
      retry_task_ids: ["task-01"],
      notes: "Correction required.",
    },
    product_context_update: "Correction required.",
    knowledge_graph_update: {
      entities: [],
      relations: [],
      decisions: [],
      risks: [],
      open_questions: [],
      summary: [],
      markdown: "",
      notes: [],
    },
    proposal_questions: [],
    confirmation_message: "Choose how to handle the correction.",
  };
}

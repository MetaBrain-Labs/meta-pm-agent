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

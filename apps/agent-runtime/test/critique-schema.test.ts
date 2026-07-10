/**
 * Critique Agent 输出契约归一化测试
 *
 * 验证模型输出跨任务 issue 或全局 issue 时，共享 schema 能将其规范化为稳定契约，
 * 避免可恢复的字段形态问题触发整个 Critique Agent fallback。
 *
 * Responsibilities:
 * - 验证 task_id 数组会展开为单任务 issue
 * - 验证 null task_id 会按全局 issue 处理
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CritiqueAgentOutputSchema,
  ProductWorkflowProposalQuestionSchema,
} from "@repo/shared";

test("normalizes critique issues with null and multiple task IDs", () => {
  const result = CritiqueAgentOutputSchema.safeParse({
    status: "pending_user_confirmation",
    confirmation_id: "product-workflow-confirmation",
    request_summary: "Review a product workflow.",
    review: {
      accepted_task_ids: ["task-01", "task-02"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [
        {
          code: "MISSING_DECISIONS",
          severity: "warning",
          task_id: ["task-01", "task-02"],
          message: "Critical decisions are still open.",
        },
      ],
      notes: "User confirmation is required.",
    },
    product_context_update: "Critical decisions remain open.",
    knowledge_graph_review: {
      accepted_task_ids: ["task-01", "task-02"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [
        {
          code: "GLOBAL_TRACEABILITY_GAP",
          severity: "warning",
          task_id: null,
          message: "Some traceability checks need more graph detail.",
        },
      ],
      notes: ["Compact graph review completed."],
    },
    proposal_questions: [
      {
        id: "q-high",
        label: "Highest priority question",
        type: "text",
        priority: "high",
      },
      {
        id: "q-medium",
        label: "Medium priority question",
        type: "text",
        priority: "medium",
      },
      {
        id: "q-low",
        label: "Low priority question",
        type: "text",
        priority: "1",
      },
    ],
    confirmation_message: "Please confirm the remaining decisions.",
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(
    result.data.review.issues.map((issue) => issue.task_id),
    ["task-01", "task-02"],
  );
  assert.equal(
    result.data.knowledge_graph_review.issues[0]?.task_id,
    undefined,
  );
  assert.deepEqual(
    result.data.proposal_questions.map((question) => question.priority),
    [3, 2, 1],
  );
});

test("rejects structurally invalid choice questions", () => {
  const result = ProductWorkflowProposalQuestionSchema.safeParse({
    id: "invalid-choice",
    label: "Choose one",
    type: "radio",
    options: ["Same", " same "],
    priority: 10,
  });

  assert.equal(result.success, false);
});

/**
 * 产品工作流补充信息表单测试
 *
 * 验证 Planner Agent 汇总 Executor 待确认问题时，会合并重复问题并保留所有来源，
 * 避免 Conversation Agent 向用户重复展示同一补充信息字段。
 *
 * Responsibilities:
 * - 覆盖 Critique Agent 结构化 proposal_questions 的去重
 * - 覆盖旧版 Executor open_questions 降级表单的去重
 * - 校验来源 help 文案仍保留所有相关 Executor/task
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
} from "@repo/shared";
import {
  formatProductWorkflowProposalQuestionForm,
} from "../src/agents/product-workflow/agent";
import { reconcileProposalQuestions } from "../src/agents/product-workflow/critique-agent/agent";

test("rejects fabricated question sources and restores actual blocking questions", () => {
  const executorResult = createExecutorResult(
    "task-01",
    "executor-product-strategy",
    ["真实问题一？", "真实问题二？"],
  );
  const questions = reconcileProposalQuestions(
    [
      {
        id: "verified",
        label: "真实问题一？",
        type: "textarea",
        required: true,
        source_task_id: "task-01",
        source_agent: "executor-product-strategy",
        sources: [
          {
            source_task_id: "task-01",
            source_agent: "executor-product-strategy",
            open_question_id: "task-01-oq-1",
          },
        ],
        priority: 10,
      },
      {
        id: "fabricated",
        label: "伪造问题？",
        type: "textarea",
        required: true,
        source_task_id: "task-01",
        source_agent: "executor-product-strategy",
        sources: [
          {
            source_task_id: "task-01",
            source_agent: "executor-product-strategy",
            open_question_id: "missing-1",
          },
        ],
        priority: 100,
      },
    ],
    [executorResult],
  );

  assert.deepEqual(
    questions.map((question) => question.label),
    ["真实问题一？", "真实问题二？"],
  );
  assert.equal(
    questions.some((question) => question.id === "fabricated"),
    false,
  );
});

test("merges duplicate planner proposal questions and preserves sources", () => {
  const form = parseQuestionForm(
    formatProductWorkflowProposalQuestionForm(
      createWorkflowResult({
        proposalQuestions: [
          {
            id: "task-01-slot-1",
            label: "请确认首批目标用户是谁？",
            type: "textarea",
            required: true,
            source_task_id: "task-01",
            source_agent: "executor-product-strategy",
            sources: [
              {
                source_task_id: "task-01",
                source_agent: "executor-product-strategy",
              },
            ],
            priority: 2,
          },
          {
            id: "task-02-slot-1",
            label: "请确认首批目标用户是谁",
            type: "textarea",
            required: true,
            source_task_id: "task-02",
            source_agent: "executor-gtm",
            sources: [
              {
                source_task_id: "task-02",
                source_agent: "executor-gtm",
              },
            ],
            priority: 4,
          },
        ],
        executorResults: [],
      }),
    ),
  );

  assert.equal(form.questions.length, 1);
  assert.equal(form.questions[0]?.label, "请确认首批目标用户是谁？");
  assert.match(
    form.questions[0]?.help ?? "",
    /executor-product-strategy \/ task-01/,
  );
  assert.match(form.questions[0]?.help ?? "", /executor-gtm \/ task-02/);
});

test("merges legacy executor open questions by actual question text", () => {
  const form = parseQuestionForm(
    formatProductWorkflowProposalQuestionForm(
      createWorkflowResult({
        proposalQuestions: [],
        executorResults: [
          createExecutorResult(
            "task-01",
            "executor-product-strategy",
            ["请确认首批目标用户是谁？"],
          ),
          createExecutorResult("task-02", "executor-gtm", [
            "请确认首批目标用户是谁",
          ]),
        ],
      }),
    ),
  );

  assert.equal(form.questions.length, 1);
  assert.equal(form.questions[0]?.label, "请确认首批目标用户是谁？");
  assert.match(
    form.questions[0]?.help ?? "",
    /executor-product-strategy \/ task-01/,
  );
  assert.match(form.questions[0]?.help ?? "", /executor-gtm \/ task-02/);
});

test("shows every blocking question and keeps non-blocking questions as backlog", () => {
  const executorResult = createExecutorResult(
    "task-01",
    "executor-product-strategy",
    Array.from({ length: 11 }, (_, index) => `Question ${index + 1}?`),
  );
  executorResult.open_questions = executorResult.open_questions.map(
    (question, index) => ({ ...question, blocking: index < 4 }),
  );

  const form = parseQuestionForm(
    formatProductWorkflowProposalQuestionForm(
      createWorkflowResult({
        proposalQuestions: [],
        executorResults: [executorResult],
      }),
    ),
  );

  assert.equal(form.questions.length, 4);
});

interface ParsedQuestionForm {
  questions: Array<{
    label: string;
    help?: string;
  }>;
}

/**
 * 从 question-form tagged block 中解析表单 JSON。
 */
function parseQuestionForm(block: string | null): ParsedQuestionForm {
  assert.ok(block);
  const openEnd = block.indexOf(">");
  const closeStart = block.lastIndexOf("</question-form>");
  assert.notEqual(openEnd, -1);
  assert.notEqual(closeStart, -1);

  return JSON.parse(
    block.slice(openEnd + 1, closeStart).trim(),
  ) as ParsedQuestionForm;
}

/**
 * 构造最小可用的产品工作流结果。
 */
function createWorkflowResult({
  proposalQuestions,
  executorResults,
}: {
  proposalQuestions: ProductWorkflowResult["proposal_questions"];
  executorResults: ExecutorAgentResult[];
}): ProductWorkflowResult {
  return {
    status: "pending_user_confirmation",
    confirmation_id: "product-workflow-confirmation",
    request_summary: "Build MVP",
    planner: {
      status: "initial",
      request_summary: "Build MVP",
      dag: {
        nodes: [],
        edges: [],
      },
      tasks: [],
      assumptions: [],
    },
    executor_results: executorResults,
    review: {
      accepted_task_ids: executorResults.map((result) => result.task_id),
      rejected_task_ids: [],
      notes: "ok",
    },
    product_context_update: "ok",
    knowledge_graph_update: {
      entities: [],
      relations: [],
      decisions: [],
      risks: [],
      open_questions: executorResults.flatMap((result) => result.open_questions),
      summary: [],
      markdown: "",
      notes: [],
    },
    proposal_questions: proposalQuestions,
    confirmation_message: "需要补充信息。",
  };
}

/**
 * 构造包含 open questions 的 Executor 结果。
 */
function createExecutorResult(
  taskId: string,
  agentType: ExecutorAgentResult["agent_type"],
  openQuestions: string[],
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
    open_questions: openQuestions.map((text, index) => ({
      id: `${taskId}-oq-${index + 1}`,
      text,
      blocking: true,
    })),
    quality_result: {
      passed: true,
      notes: "ok",
    },
  };
}

/**
 * Workflow 恢复上下文测试
 *
 * 验证 HITL 表单答案和用户继续指令可以从历史消息中恢复 Planner DAG、Request Analysis
 * 和受影响 Executor 任务，确保后续运行复用已有上下文而不是重新解释最新一句话。
 *
 * Responsibilities:
 * - 覆盖硬阻塞表单的任务定位
 * - 覆盖补充信息确认表单的 Executor open question 定位
 * - 覆盖中断后继续运行时对既有 Request Analysis 的复用
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ChatMessage,
  ProductWorkflowResult,
  TaskExecutionPlan,
} from "@repo/shared";
import {
  createWorkflowContinuationResumeContextFromMessages,
  createWorkflowExecutorRetryResumeContextFromMessages,
  createWorkflowResumeContextFromMessages,
  inferSupplementAffectedTaskIds,
} from "../src/agents/conversation/workflow-resume";
import {
  createCritiqueCorrectionUserInputBlock,
  streamConversation,
} from "../src/agents/conversation/stream";
import { createProductWorkflowKnowledgeGraph } from "../src/agents/product-workflow/common/knowledge-graph";

test("restores direct executor blocker context from history", () => {
  const knowledgeGraph = createProductWorkflowKnowledgeGraph();
  knowledgeGraph.open_questions = [
    { id: "task-01-oq", text: "Market scope?", source_task_id: "task-01", blocking: true },
    { id: "task-02-oq", text: "Launch date?", source_task_id: "task-02", blocking: false },
  ];
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages(
      "[form answers - executor-blocker-task-01]\n- resolution: use B2B scope",
    ),
    knowledgeGraph,
  });

  assert.equal(
    context?.requestAnalysis?.business_model[0]?.user_goal,
    "Build MVP",
  );
  assert.equal(context?.plan?.tasks.length, 2);
  assert.deepEqual(context?.rerunTaskIds, ["task-01"]);
  assert.equal(context?.executorResults?.length, 2);
  assert.equal(context?.executorResults?.[0]?.open_questions.length, 2);
  assert.deepEqual(
    context?.knowledgeGraph?.open_questions.map((question) => question.id),
    ["task-01-oq", "task-02-oq"],
  );
});

test("restores the original structured user input for resumed corrections", () => {
  const messages = createMessages(
    "[form answers - executor-blocker-task-01]\n- resolution: keep scope",
  );
  messages.splice(
    1,
    0,
    message(
      "a0",
      "assistant",
      `<user-input>\n${JSON.stringify({
        user_input: [
          { index: 1, type: "request", content: "Build MVP" },
          {
            index: 5,
            type: "constraint",
            content: "无特殊技术或平台约束",
          },
        ],
      })}\n</user-input>`,
    ),
  );

  const context = createWorkflowResumeContextFromMessages({ messages });

  assert.equal(context?.originalUserInput?.[1]?.index, 5);
  assert.equal(
    context?.originalUserInput?.[1]?.content,
    "无特殊技术或平台约束",
  );
});

test("restores proposal context for executors with open questions", () => {
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages(
      "[form answers - product-workflow-confirmation-proposal-decision]\n- Market scope?: enterprise",
    ),
  });

  assert.deepEqual(context?.rerunTaskIds, ["task-01"]);
});

test("restores planner review retry task ids from proposal answers", () => {
  const messages = createMessages(
    "[form answers - product-workflow-confirmation-proposal-decision]\n- Fix graph?: yes",
  );
  messages.splice(
    messages.length - 1,
    0,
    message("a5", "assistant", createProductWorkflowBlock()),
  );

  const context = createWorkflowResumeContextFromMessages({ messages });

  assert.deepEqual(context?.rerunTaskIds, ["task-02", "task-01"]);
});

test("restores final confirmation context for executors with open questions", () => {
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages(
      "[form answers - product-workflow-confirmation]\n- 下一步处理方式: 确认接受",
    ),
  });

  assert.deepEqual(context?.rerunTaskIds, ["task-01"]);
});

test("restores dynamic Critique confirmation as a scoped supplement", () => {
  const knowledgeGraph = createProductWorkflowKnowledgeGraph();
  knowledgeGraph.open_questions = [
    { id: "task-01-oq", text: "Market scope?", source_task_id: "task-01", blocking: true },
    { id: "task-01-oq-2", text: "Sync strategy?", source_task_id: "task-01", blocking: true },
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `task-01-block-${index + 3}`,
      text: `Blocking question ${index + 3}?`,
      source_task_id: "task-01",
      blocking: true,
    })),
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `task-01-backlog-${index + 1}`,
      text: `Backlog question ${index + 1}?`,
      source_task_id: "task-01",
      blocking: false,
    })),
  ];
  const messages = createMessages(
    "[form answers - critique-result-001]\n- Sync strategy: Last-Write-Wins",
  );
  messages.splice(
    messages.length - 1,
    0,
    message(
      "a5",
      "assistant",
      createProductWorkflowBlock("critique-result-001"),
    ),
  );

  const context = createWorkflowResumeContextFromMessages({
    messages,
    knowledgeGraph,
  });

  assert.equal(context?.forceSupplementPlan, true);
  assert.deepEqual(context?.rerunTaskIds, ["task-02", "task-01"]);
  assert.deepEqual(context?.supplementAgentTypes, [
    "executor-product-strategy",
    "executor-product-execution",
  ]);
  assert.deepEqual(context?.supplementSourceTaskIds, ["task-02", "task-01"]);
  assert.deepEqual(context?.supplementAffectedTaskIds, ["task-01", "task-02"]);
  assert.deepEqual(context?.answeredOpenQuestionIds, [
    "task-01-oq",
    "task-01-oq-2",
  ]);
  assert.equal(context?.productWorkflow?.confirmation_id, "critique-result-001");
  assert.deepEqual(context?.executorResults?.[0]?.open_questions, []);
  assert.deepEqual(
    context?.knowledgeGraph?.open_questions.map((question) => question.id),
    [
      "task-01-block-3",
      "task-01-block-4",
      ...Array.from({ length: 7 }, (_, index) =>
        `task-01-backlog-${index + 1}`,
      ),
    ],
  );
});

test("expands supplement scope to one-hop graph owners", () => {
  const graph = createProductWorkflowKnowledgeGraph();
  graph.entities = [
    {
      id: "R-001",
      type: "Requirement",
      name: "SM4 encryption",
      source_task_id: "task-strategy",
      status: "confirmed",
    },
    {
      id: "C-001",
      type: "Custom",
      name: "AES-256 guardrail",
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
  const plan = {
    status: "initial",
    request_summary: "Encryption policy",
    dag: {
      nodes: ["task-strategy", "task-toolkit"],
      edges: [],
    },
    tasks: [
      {
        task_id: "task-strategy",
        sequence: 1,
        title: "Strategy",
        description: "Confirm encryption requirement.",
        assigned_agent: "executor-product-strategy",
        depends_on: [],
        covered_business_model_indexes: [1],
        expected_output: "Requirement",
        quality_check: { status: "pending", criteria: ["Traceable"] },
      },
      {
        task_id: "task-toolkit",
        sequence: 2,
        title: "Toolkit",
        description: "Maintain encryption guardrails.",
        assigned_agent: "executor-toolkit",
        depends_on: [],
        covered_business_model_indexes: [1],
        expected_output: "Constraint",
        quality_check: { status: "pending", criteria: ["Traceable"] },
      },
    ],
    assumptions: [],
  } satisfies TaskExecutionPlan;

  assert.deepEqual(
    inferSupplementAffectedTaskIds(
      ["task-strategy"],
      plan,
      graph,
    ),
    ["task-strategy", "task-toolkit"],
  );
});

test("closes all answered form questions without restored product workflow payload", () => {
  const knowledgeGraph = createProductWorkflowKnowledgeGraph();
  knowledgeGraph.open_questions = [
    { id: "OQ-roles", text: "确认角色权限？", source_task_id: "task-01", blocking: true },
    { id: "OQ-formats", text: "确认文档格式？", source_task_id: "task-01", blocking: true },
    { id: "OQ-deployment", text: "确认部署环境？", source_task_id: "task-01", blocking: true },
  ];
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages(
      "[form answers - review-proposal-decision]\n- 确认角色权限？: 管理员、编辑、只读\n- 确认文档格式？: Markdown 与 Word\n- 确认部署环境？: Docker Compose",
    ),
    knowledgeGraph,
    workflowAnswerResolution: {
      action: "submit_answers",
      formId: "review-proposal-decision",
      questions: knowledgeGraph.open_questions.map((question) => ({
        label: question.text,
        answered: true,
        sources: [
          {
            source_task_id: "task-01",
            source_agent: "executor-product-strategy",
            open_question_id: question.id,
          },
        ],
      })),
    },
  });

  assert.deepEqual(context?.answeredOpenQuestionIds, [
    "OQ-roles",
    "OQ-formats",
    "OQ-deployment",
  ]);
  assert.deepEqual(context?.knowledgeGraph?.open_questions, []);
  assert.deepEqual(context?.knowledgeGraph?.resolved_open_question_ids, [
    "OQ-roles",
    "OQ-formats",
    "OQ-deployment",
  ]);
});

test("keeps skipped questions open and preserves their source agent", () => {
  const knowledgeGraph = createProductWorkflowKnowledgeGraph();
  knowledgeGraph.open_questions = [
    { id: "task-01-oq", text: "Market scope?", source_task_id: "task-01", blocking: true },
    { id: "task-01-oq-2", text: "Sync strategy?", source_task_id: "task-01", blocking: true },
  ];
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages(
      "[form answers - review-proposal-decision]\n- Market scope?: enterprise\n- Sync strategy?: (skipped)",
    ),
    knowledgeGraph,
    workflowAnswerResolution: {
      action: "submit_answers",
      formId: "review-proposal-decision",
      questions: [
        {
          label: "Market scope?",
          answered: true,
          sources: [
            {
              source_task_id: "task-01",
              source_agent: "executor-product-strategy",
              open_question_id: "task-01-oq",
            },
          ],
        },
        {
          label: "Sync strategy?",
          answered: false,
          sources: [
            {
              source_task_id: "task-01",
              source_agent: "executor-product-strategy",
              open_question_id: "task-01-oq-2",
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(context?.answeredOpenQuestionIds, ["task-01-oq"]);
  assert.deepEqual(context?.knowledgeGraph?.open_questions, [
    {
      id: "task-01-oq-2",
      text: "Sync strategy?",
      source_task_id: "task-01",
      source_agent: "executor-product-strategy",
      blocking: true,
    },
  ]);
});

test("uses unique task and text matching for legacy form sources", () => {
  const knowledgeGraph = createProductWorkflowKnowledgeGraph();
  knowledgeGraph.open_questions = [
    { id: "task-01-oq", text: "Market scope?", source_task_id: "task-01", blocking: true },
  ];
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages(
      "[form answers - review-proposal-decision]\n- Market scope?: enterprise",
    ),
    knowledgeGraph,
    workflowAnswerResolution: {
      action: "submit_answers",
      formId: "review-proposal-decision",
      questions: [
        {
          label: "Market scope?",
          answered: true,
          sources: [
            {
              source_task_id: "task-01",
              source_agent: "executor-product-strategy",
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(context?.answeredOpenQuestionIds, ["task-01-oq"]);
  assert.deepEqual(context?.knowledgeGraph?.open_questions, []);
});

test("does not close ambiguous legacy text matches", () => {
  const knowledgeGraph = createProductWorkflowKnowledgeGraph();
  knowledgeGraph.open_questions = [
    { id: "task-01-oq", text: "Market scope?", source_task_id: "task-01", blocking: true },
    { id: "task-01-oq-copy", text: "Market scope?", source_task_id: "task-01", blocking: true },
  ];
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessages(
      "[form answers - review-proposal-decision]\n- Market scope?: enterprise",
    ),
    knowledgeGraph,
    workflowAnswerResolution: {
      action: "submit_answers",
      formId: "review-proposal-decision",
      questions: [
        {
          label: "Market scope?",
          answered: true,
          sources: [
            {
              source_task_id: "task-01",
              source_agent: "executor-product-strategy",
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(context?.answeredOpenQuestionIds, []);
  assert.equal(context?.knowledgeGraph?.open_questions.length, 2);
});

test("restores latest supplement DAG for continue intent", () => {
  const messages = createMessages("继续");
  messages.splice(
    messages.length - 1,
    0,
    message("a5", "assistant", createSupplementTaskExecutionBlock()),
  );

  const context = createWorkflowContinuationResumeContextFromMessages({
    messages,
  });

  assert.equal(context?.plan?.status, "supplement");
  assert.deepEqual(context?.rerunTaskIds, ["task-01"]);
  assert.equal(
    context?.executorResults?.some((result) => result.task_id === "task-01"),
    false,
  );
});

test("does not restore interrupted workflow by matching latest user text", () => {
  const context = createWorkflowResumeContextFromMessages({
    messages: createMessagesWithRequestAnalysisOnly("继续之前中断的对话"),
  });

  assert.equal(context, null);
});

test("restores an executor retry without replaying the latest form answer", () => {
  const messages = createMessages(
    "[form answers - product-workflow-confirmation-proposal-decision]\n- Market scope?: enterprise",
  ).filter(
    (item) =>
      !item.content.includes("<executor-result>") ||
      !item.content.includes('"task_id":"task-02"'),
  );
  messages.splice(
    1,
    0,
    message(
      "a0",
      "assistant",
      '<user-input>\n{"user_input":[{"index":1,"content":"Build MVP","type":"请求"}]}\n</user-input>',
    ),
  );

  const context = createWorkflowExecutorRetryResumeContextFromMessages({
    messages,
    taskId: "task-02",
  });

  assert.deepEqual(context?.rerunTaskIds, ["task-02"]);
  assert.equal(context?.executorResults?.length, 1);
  assert.match(context?.userInputBlock ?? "", /Build MVP/);
});

test("stopping optional questions completes without another form or orchestrator", async () => {
  const messages = createMessages(
    "[form answers - critique-result-proposal-decision]\n- workflow_action: stop_optional_questions",
  );
  const workflow = createProductWorkflowResult("critique-result");
  workflow.review.rejected_task_ids = [];
  workflow.review.retry_task_ids = [];
  workflow.review.issues = [];
  messages.splice(
    messages.length - 1,
    0,
    message(
      "a5",
      "assistant",
      `<product-workflow>\n${JSON.stringify(workflow)}\n</product-workflow>`,
    ),
  );
  const events = [];

  for await (const event of streamConversation(messages, { mode: "project" })) {
    events.push(event);
  }

  const completed = events.find((event) => event.type === "complete");
  assert.equal(completed?.type === "complete" && completed.result.status, "completed");
  assert.deepEqual(
    completed?.type === "complete" && completed.result.proposal_questions,
    [],
  );
  assert.equal(
    completed?.type === "complete" &&
      completed.result.knowledge_graph_update.current_state,
    "stable",
  );
  assert.equal(
    events.some((event) => event.type === "question-form-complete"),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "agent-status" && event.agentType === "orchestrator",
    ),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "text" &&
        event.content.includes("本轮产品工作流已正式结束"),
    ),
    true,
  );
});

test("stopping a hard Critique error discards without starting another workflow round", async () => {
  const workflow = createProductWorkflowResult("critique-result");
  workflow.status = "requires_executor_retry";
  const messages = createMessages(
    "[form answers - critique-result-proposal-decision]\n- 请选择如何处理审查错误？: 停止并保留问题结果",
  );
  const events = [];

  for await (const event of streamConversation(messages, {
    mode: "project",
    workflowAnswerResolution: {
      action: "stop_with_issues",
      formId: "critique-result-proposal-decision",
      questions: [],
      workflow,
    },
  })) {
    events.push(event);
  }

  const completed = events.find((event) => event.type === "complete");
  assert.equal(completed?.type === "complete" && completed.result.status, "discarded");
  assert.equal(
    events.some((event) => event.type === "workflow-round-start"),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "agent-status" &&
        ["request", "planner", "orchestrator"].includes(event.agentType ?? ""),
    ),
    false,
  );
});

test("scopes Critique correction input to retry-task errors", () => {
  const workflow = createProductWorkflowResult("critique-result");
  workflow.review.issues.push(
    {
      code: "DUPLICATE_METRIC",
      severity: "warning",
      task_id: "task-02",
      message: "Warning must not create supplement work.",
    },
    {
      code: "UNRELATED_ERROR",
      severity: "error",
      task_id: "task-01",
      message: "Another task is outside the persisted retry scope.",
    },
  );

  const block = createCritiqueCorrectionUserInputBlock(
    workflow,
    "- 请选择如何处理审查错误？: 生成补充修正任务\n- 补充约束: keep exact ids",
    ["task-02"],
  );

  assert.match(block, /NO_STRUCTURED_GRAPH_PATCH \(task-02\)/);
  assert.match(block, /User-supplied correction constraints/);
  assert.match(block, /补充约束: keep exact ids/);
  assert.doesNotMatch(block, /DUPLICATE_METRIC/);
  assert.doesNotMatch(block, /UNRELATED_ERROR/);
  assert.equal(block.match(/NO_STRUCTURED_GRAPH_PATCH/g)?.length, 1);
});

test("preserves document evidence purpose when Critique correction replaces source task ids", () => {
  const messages = createMessages(
    "[form answers - critique-result-proposal-decision]\n- workflow_action: retry_correction",
  );
  const workflow = createProductWorkflowResult("critique-result");
  const baseline = createWorkflowResumeContextFromMessages({ messages });
  assert.ok(baseline?.requestAnalysis);

  const context = createWorkflowResumeContextFromMessages({
    messages,
    serverWorkflowRecoveryContext: {
      workflowPurpose: "document_evidence_resolution",
      requestAnalysis: baseline.requestAnalysis,
      planner: workflow.planner,
      executorResults: [],
      critique: workflow,
      correctionSource: {
        formId: "critique-result-proposal-decision",
        action: "retry_correction",
        retryTaskIds: ["task-02"],
      },
    },
    workflowAnswerResolution: {
      action: "retry_correction",
      formId: "critique-result-proposal-decision",
      workflow,
      questions: [],
    },
  });

  assert.equal(context?.workflowPurpose, "document_evidence_resolution");
  assert.ok(context?.supplementSourceTaskIds?.includes("task-02"));
  assert.equal(
    context?.supplementSourceTaskIds?.some((taskId) =>
      taskId.startsWith("document-evidence:"),
    ),
    false,
  );
  assert.equal(context?.forceSupplementPlan, true);
});

test("accepts a persisted final workflow without client workflow history", async () => {
  const messages = createMessages(
    "[form answers - product-workflow-confirmation]\n- 你希望如何处理当前结果？: 确认接受\n- 补充说明: (skipped)",
  );
  const events = [];

  for await (const event of streamConversation(messages, {
    mode: "project",
    workflowAnswerResolution: {
      action: "submit_answers",
      formId: "product-workflow-confirmation",
      questions: [],
      workflow: createProductWorkflowResult(),
    },
  })) {
    events.push(event);
  }

  const completed = events.find((event) => event.type === "complete");
  assert.equal(completed?.type === "complete" && completed.result.status, "completed");
  assert.equal(
    events.some(
      (event) => event.type === "agent-status" && event.agentType === "request",
    ),
    false,
  );
});

test("does not send final acceptance to Request Agent when persisted workflow is missing", async () => {
  const messages = createMessages(
    "[form answers - product-workflow-confirmation]\n- 你希望如何处理当前结果？: 确认接受",
  );
  const events = [];

  for await (const event of streamConversation(messages, { mode: "project" })) {
    events.push(event);
  }

  assert.equal(
    events.some(
      (event) =>
        event.type === "error" &&
        event.agentType === "conversation_confirmation" &&
        event.terminal,
    ),
    true,
  );
  assert.equal(
    events.some(
      (event) => event.type === "agent-status" && event.agentType === "request",
    ),
    false,
  );
});

function createMessages(latestAnswer: string): ChatMessage[] {
  return [
    message("u1", "user", "Build MVP"),
    message("a1", "assistant", createRequestAnalysisBlock()),
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

function createSupplementTaskExecutionBlock(): string {
  return `<task-execution>\n${JSON.stringify({
    status: "supplement",
    request_summary: "Supplement workflow",
    dag: {
      nodes: ["task-01"],
      edges: [],
    },
    tasks: [
      {
        task_id: "task-01",
        sequence: 1,
        title: "Supplement strategy",
        description: "Correct the strategy graph",
        assigned_agent: "executor-product-strategy",
        depends_on: [],
        covered_business_model_indexes: [1],
        expected_output: "Corrected strategy graph",
        quality_check: { status: "pending", criteria: ["traceable"] },
      },
    ],
    assumptions: [],
  })}\n</task-execution>`;
}

function createProductWorkflowBlock(
  confirmationId = "product-workflow-confirmation",
): string {
  return `<product-workflow>\n${JSON.stringify(
    createProductWorkflowResult(confirmationId),
  )}\n</product-workflow>`;
}

function createProductWorkflowResult(
  confirmationId = "product-workflow-confirmation",
): ProductWorkflowResult {
  const result: ProductWorkflowResult = {
    status: "pending_user_confirmation",
    confirmation_id: confirmationId,
    request_summary: "Build MVP",
    planner: {
      status: "initial",
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
    },
    executor_results: [],
    review: {
      accepted_task_ids: ["task-01"],
      rejected_task_ids: ["task-02"],
      retry_task_ids: ["task-02"],
      issues: [
        {
          code: "NO_STRUCTURED_GRAPH_PATCH",
          severity: "error",
          task_id: "task-02",
          message: "Executor result contains no structured graph patch items.",
        },
      ],
      notes: "task-02 needs correction.",
    },
    product_context_update: "task-02 needs correction.",
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
    knowledge_graph_review: {
      accepted_task_ids: ["task-01"],
      rejected_task_ids: ["task-02"],
      retry_task_ids: ["task-02"],
      issues: [
        {
          code: "NO_STRUCTURED_GRAPH_PATCH",
          severity: "error",
          task_id: "task-02",
          message: "Executor result contains no structured graph patch items.",
        },
      ],
      notes: ["task-02 needs correction."],
    },
    proposal_questions: [
      {
        id: "planner-review-retry",
        label: "Fix graph?",
        type: "radio",
        required: true,
        options: ["yes", "no"],
        source_task_id: "task-02",
        source_agent: "executor-product-execution",
        sources: [
          {
            source_task_id: "task-02",
            source_agent: "executor-product-execution",
          },
          {
            source_task_id: "task-01",
            source_agent: "executor-product-strategy",
            open_question_id: "task-01-oq",
          },
          {
            source_task_id: "task-01",
            source_agent: "executor-product-strategy",
            open_question_id: "task-01-oq-2",
          },
        ],
        priority: 100,
      },
    ],
    confirmation_message: "Please confirm correction.",
  };

  return result;
}

function createMessagesWithRequestAnalysisOnly(
  latestMessage: string,
): ChatMessage[] {
  return [
    message("u1", "user", "Build MVP"),
    message("a1", "assistant", createRequestAnalysisBlock()),
    message("u2", "user", latestMessage),
  ];
}

function createRequestAnalysisBlock(): string {
  return `<request-analysis>\n${JSON.stringify({
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
  })}\n</request-analysis>`;
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
      ? [
          { id: `${taskId}-oq`, text: "Market scope?", blocking: true },
          { id: `${taskId}-oq-2`, text: "Sync strategy?", blocking: true },
        ]
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

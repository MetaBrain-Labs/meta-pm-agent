/**
 * 文档证据阻断解决流程测试
 *
 * 验证 Resolver 的确定性覆盖率校验和评分后的五分支路由，不调用真实模型或数据库。
 *
 * Responsibilities:
 * - 验证重复 blocker 可合并且全部问题必填
 * - 验证无效输出回退为覆盖全部 blocker 的 textarea
 * - 验证通过、普通重试、高分差重试、证据等待和轮次耗尽路由
 * - 验证文档图谱规范化不会丢失源版本
 *
 * Notes:
 * - 使用最小图谱快照，聚焦纯函数业务不变量。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDocumentEvidenceQuestionForm,
  isAcceptedDocumentEvidenceWorkflowResult,
  normalizeDocumentEvidenceWorkflowResult,
  normalizeDocumentEvidenceResolution,
  selectNextNodeAfterScore,
  type DocumentEvidenceResolutionInput,
} from "../src";
import {
  createDocumentEvidenceResolutionPayload,
  createDocumentEvidenceResolverPrompt,
} from "../src/agents/product-workflow/orchestrator-agent/document-evidence-resolver-subagent/prompt";
import {
  createDocumentEvidenceRequestAnalysis,
  createDocumentEvidenceSupplementContext,
  createFormAnswerUserInputBlock,
} from "../src/agents/conversation/stream";
import { parseUserInputBlock } from "../src/agents/request/user-input";
import { normalizeDocumentWorkflowGraph } from "../src/graph/document-workflow";

const input: DocumentEvidenceResolutionInput = {
  runId: "run-1",
  workspaceId: "workspace-1",
  sourceGraphVersion: 3,
  blockers: [
    { index: 0, reviewerId: "r1", reviewerName: "R1", text: "Missing source" },
    { index: 1, reviewerId: "r2", reviewerName: "R2", text: "Missing source citation" },
  ],
  knowledgeGraph: {
    entities: [],
    relations: [],
    markdown: "",
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    notes: [],
  },
};

test("serializes evidence-resolution answers as valid Request Agent user_input", () => {
  const content = [
    "Resolve persisted PRD evidence blockers for document run run-1.",
    "Q1: Use the confirmed MVP scope.",
    'Blocker-to-question mapping: [{"questionId":"q1","blockerIndexes":[0,1]}]',
  ].join("\n\n");

  assert.deepEqual(parseUserInputBlock(createFormAnswerUserInputBlock(content)), [
    {
      index: 1,
      content,
      type: "表单答复",
    },
  ]);
});

test("uses trusted request analysis for evidence answers without adding missing information", () => {
  assert.deepEqual(createDocumentEvidenceRequestAnalysis(), {
    business_model: [
      {
        index: 1,
        user_goal:
          "Resolve persisted PRD evidence blockers with the submitted authoritative answers.",
        goal_constraints: [
          "Update only the related product knowledge graph facts and decisions.",
        ],
        missing_information: [],
        covered_user_input_indexes: [1],
      },
    ],
    questions: [],
    chitchat: [],
  });
});

test("keeps merged resolver questions required and covers every blocker", () => {
  const result = normalizeDocumentEvidenceResolution(
    {
      summary: "Collect source evidence",
      questions: [
        {
          id: "source",
          label: "Provide the source or explicitly mark it unknown.",
          type: "textarea",
          required: true,
          blockerIndexes: [0, 1],
          suggestedAgentTypes: ["executor-market-research"],
          relatedNodeIds: [],
        },
      ],
    },
    input,
  );

  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0]?.required, true);
  assert.deepEqual(result.questions[0]?.blockerIndexes, [0, 1]);
  assert.match(result.questions[0]?.help ?? "", /当前已知资料：/);
  assert.match(result.questions[0]?.help ?? "", /Missing source citation/);
});

test("falls back to one required textarea when blocker coverage is invalid", () => {
  const result = normalizeDocumentEvidenceResolution(
    {
      summary: "Incomplete mapping",
      questions: [
        {
          id: "source",
          label: "Provide the source.",
          type: "text",
          required: true,
          blockerIndexes: [0],
          suggestedAgentTypes: [],
          relatedNodeIds: [],
        },
      ],
    },
    input,
  );

  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0]?.type, "textarea");
  assert.equal(result.questions[0]?.required, true);
  assert.deepEqual(result.questions[0]?.blockerIndexes, [0, 1]);
});

test("keeps trusted active Risk and OpenQuestion IDs and removes invented related nodes", () => {
  const result = normalizeDocumentEvidenceResolution(
    {
      summary: "Resolve the certification risk",
      questions: [
        {
          id: "risk",
          label: "Confirm the certification.",
          type: "text",
          required: true,
          blockerIndexes: [0, 1],
          suggestedAgentTypes: ["executor-product-strategy"],
          relatedNodeIds: ["RISK-1", "OQ-1", "RISK-invented"],
        },
      ],
    },
    {
      ...input,
      knowledgeGraph: {
        ...input.knowledgeGraph,
        risks: [{ id: "RISK-1", text: "Certification is not confirmed." }],
        open_questions: [
          {
            id: "OQ-1",
            text: "Who approves the certification evidence?",
            source_task_id: "task-1",
            blocking: true,
          },
        ],
      },
    },
  );

  assert.deepEqual(result.questions[0]?.relatedNodeIds, ["RISK-1", "OQ-1"]);
});

test("closes evidence-linked OpenQuestions before planning and removes them from Executor mappings", () => {
  const resolution = {
    summary: "Resolve approval evidence",
    questions: [
      {
        id: "approval",
        label: "Confirm the approver and source.",
        type: "text" as const,
        required: true as const,
        blockerIndexes: [0, 1],
        suggestedAgentTypes: ["executor-product-strategy"],
        relatedNodeIds: ["OQ-full-id", "RISK-1"],
      },
    ],
  };
  const context = createDocumentEvidenceSupplementContext(
    {
      runId: "run-1",
      sourceGraphVersion: 3,
      answerText: "The product owner approved it in decision record DR-1.",
      resolution,
      suggestedAgentTypes: ["executor-product-strategy"],
      relatedNodeIds: ["OQ-full-id", "RISK-1"],
    },
    {
      ...input.knowledgeGraph,
      risks: [{ id: "RISK-1", text: "Approval is not confirmed." }],
      open_questions: [
        {
          id: "OQ-full-id",
          text: "Who approved the scope?",
          source_task_id: "task-1",
          blocking: true,
        },
        {
          id: "OQ-unrelated",
          text: "What is the launch date?",
          source_task_id: "task-2",
          blocking: true,
        },
      ],
    },
  );

  assert.deepEqual(context.answeredOpenQuestionIds, ["OQ-full-id"]);
  assert.deepEqual(context.relatedNodeIds, ["OQ-full-id", "RISK-1"]);
  assert.deepEqual(context.knowledgeGraph.resolved_open_question_ids, [
    "OQ-full-id",
  ]);
  assert.deepEqual(
    context.knowledgeGraph.open_questions.map((question) => question.id),
    ["OQ-unrelated"],
  );
  assert.deepEqual(context.blockerQuestionMapping[0]?.relatedNodeIds, [
    "RISK-1",
  ]);
});

test("injects every trusted blocker and the exact label contract into Resolver context", () => {
  const resolutionInput = {
    ...input,
    blockers: input.blockers.map((blocker) => ({
      ...blocker,
      relatedNodeIds: ["FR-01", "RISK-1"],
    })),
    knowledgeGraph: {
      ...input.knowledgeGraph,
      entities: [
        {
          id: "FR-01",
          type: "Requirement" as const,
          name: "用户登录",
          description: "用户可使用企业账号登录 MVP。",
          status: "confirmed" as const,
        },
        {
          id: "GOAL-01",
          type: "Goal" as const,
          name: "三个月交付",
          description: "计划在三个月内交付首版。",
          status: "proposed" as const,
        },
        {
          id: "M-UNRELATED",
          type: "Metric" as const,
          name: "Unrelated metric",
          description: "Must not be copied into the detailed Resolver subgraph.",
          status: "proposed" as const,
        },
      ],
      relations: [
        {
          id: "REL-01",
          type: "Satisfies" as const,
          source: "FR-01",
          target: "GOAL-01",
          description: "登录能力属于首版交付范围。",
        },
      ],
      risks: [{ id: "RISK-1", text: "Certification is not confirmed." }],
    },
  };
  const payload = createDocumentEvidenceResolutionPayload(resolutionInput);
  const prompt = createDocumentEvidenceResolverPrompt(resolutionInput);

  assert.deepEqual(payload.blockers, resolutionInput.blockers);
  assert.equal(
    payload.knowledge_graph.entities[0]?.description,
    "用户可使用企业账号登录 MVP。",
  );
  assert.equal(payload.knowledge_graph.relations[0]?.target, "GOAL-01");
  assert.deepEqual(
    payload.knowledge_graph.entities.map((entity) => entity.id),
    ["FR-01", "GOAL-01"],
  );
  assert.deepEqual(
    payload.knowledge_graph.node_index.map((entity) => entity.id),
    ["FR-01", "GOAL-01", "M-UNRELATED"],
  );
  assert.equal("description" in payload.knowledge_graph, false);
  assert.equal(payload.knowledge_graph.risks[0]?.id, "RISK-1");
  assert.match(prompt, /Missing source citation/);
  assert.match(prompt, /"label":/);
  assert.match(prompt, /never "question"/);
  assert.match(prompt, /Never ask the user to restate, categorize, prioritize, map/);
  assert.match(prompt, /Do not ask which requirements, metrics, or decisions/);
  assert.match(prompt, /Expand symbolic references such as FR-01~05/);
});

test("keeps Resolver context bounded when blockers provide no related node IDs", () => {
  const manyEntities = Array.from({ length: 100 }, (_, index) => ({
    id: `R-${String(index + 1).padStart(3, "0")}`,
    type: "Requirement" as const,
    name: `Requirement ${index + 1}`,
    description: `Detailed requirement ${index + 1}`,
    status: "confirmed" as const,
  }));
  const payload = createDocumentEvidenceResolutionPayload({
    ...input,
    knowledgeGraph: {
      ...input.knowledgeGraph,
      entities: manyEntities,
      relations: [],
    },
  });

  assert.equal(payload.knowledge_graph.entities.length, 0);
  assert.equal(payload.knowledge_graph.node_index.length, 80);
});

test("rejects oversized Resolver question fields and uses the bounded fallback", () => {
  const result = normalizeDocumentEvidenceResolution(
    {
      summary: "Collect evidence",
      questions: [
        {
          id: "oversized-question",
          label: "x".repeat(241),
          type: "textarea",
          required: true,
          blockerIndexes: [0, 1],
          suggestedAgentTypes: [],
          relatedNodeIds: [],
        },
      ],
    },
    input,
  );

  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0]?.id, "evidence-resolution-details");
  assert.ok((result.questions[0]?.help?.length ?? 0) <= 1200);
  assert.ok((result.questions[0]?.placeholder?.length ?? 0) <= 800);
});

test("formats evidence blockers with modal help while keeping the question visible", () => {
  const resolution = normalizeDocumentEvidenceResolution(
    {
      summary: "确认 MVP 范围",
      questions: [
        {
          id: "mvp-scope",
          label: "请确认 MVP 范围是否最终确定。",
          type: "radio",
          required: true,
          help: "当前已知资料：FR-01 用户登录。\n阻断原因：范围尚未最终确认。",
          options: ["已确定", "尚未确定"],
          blockerIndexes: [0, 1],
          suggestedAgentTypes: ["executor-product-strategy"],
          relatedNodeIds: [],
        },
      ],
    },
    input,
  );
  const form = formatDocumentEvidenceQuestionForm({
    runId: "run-1",
    resolution,
  });

  assert.match(form, /"helpMode": "modal"/);
  assert.match(form, /FR-01 用户登录/);
  assert.doesNotMatch(form, /"collapsible": true/);
});

test("preserves source graph version while normalizing document graph", () => {
  const node = { id: "goal-1", type: "Goal" as const, name: "Goal" };
  const normalized = normalizeDocumentWorkflowGraph({
    nodes: [node, node],
    relations: [
      {
        id: "dangling",
        type: "References",
        source: "goal-1",
        target: "missing",
      },
    ],
    version: 7,
  });

  assert.equal(normalized.version, 7);
  assert.equal(normalized.nodes.length, 1);
  assert.equal(normalized.relations.length, 0);
});

test("does not accept document evidence with an unconsumed Evidence issue", () => {
  const result = {
    status: "completed",
    review: {
      retry_task_ids: [],
      issues: [
        {
          code: "UNCONSUMED_EVIDENCE",
          severity: "warning",
          message: "Evidence is not consumed.",
        },
      ],
    },
    knowledge_graph_review: { issues: [] },
  } as any;

  assert.equal(isAcceptedDocumentEvidenceWorkflowResult(result), false);
  result.review.issues = [];
  assert.equal(isAcceptedDocumentEvidenceWorkflowResult(result), true);
});

test("normalizes historical document completion with unconsumed Evidence into correction", () => {
  const result = {
    status: "completed",
    confirmation_id: "critique-document-1",
    request_summary: "Resolve evidence",
    planner: {
      status: "supplement",
      request_summary: "Resolve evidence",
      dag: { nodes: ["supplement-task-01"], edges: [] },
      tasks: [
        {
          task_id: "supplement-task-01",
          sequence: 1,
          title: "Repair evidence",
          description: "Repair exact evidence",
          assigned_agent: "executor-product-strategy",
          depends_on: [],
          covered_business_model_indexes: [1],
          expected_output: "Consumed Evidence",
          quality_check: { status: "pending", criteria: ["traceable"] },
        },
      ],
      assumptions: [],
    },
    executor_results: [],
    review: {
      accepted_task_ids: ["supplement-task-01"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [
        {
          code: "UNCONSUMED_EVIDENCE",
          severity: "warning",
          task_id: "supplement-task-01",
          message: "Evidence E-orphan is not consumed.",
        },
      ],
      notes: "Model considered the warning non-blocking.",
    },
    product_context_update: "Evidence added.",
    knowledge_graph_update: input.knowledgeGraph,
    knowledge_graph_review: {
      accepted_task_ids: ["supplement-task-01"],
      rejected_task_ids: [],
      retry_task_ids: [],
      issues: [],
      notes: [],
    },
    proposal_questions: [],
    confirmation_message: "Completed.",
  } as any;

  const normalized = normalizeDocumentEvidenceWorkflowResult(result);
  assert.equal(normalized.status, "requires_executor_retry");
  assert.deepEqual(normalized.review.retry_task_ids, ["supplement-task-01"]);
  assert.deepEqual(normalized.review.accepted_task_ids, []);
  assert.equal(normalized.review.issues[0]?.severity, "error");
  assert.equal(isAcceptedDocumentEvidenceWorkflowResult(normalized), false);
});

test("routes document scoring outcomes with evidence blockers first", () => {
  assert.equal(selectRoute({ passed: true }), "review");
  assert.equal(selectRoute({ varianceAccepted: false }), "retry");
  assert.equal(
    selectRoute({ varianceAccepted: false, evidenceBlocked: true }),
    "export",
  );
  assert.equal(selectRoute({ evidenceBlocked: false }), "retry");
  assert.equal(selectRoute({ evidenceBlocked: true }), "export");
  assert.equal(selectRoute({ evidenceBlocked: false }, 3), "export");
});

function selectRoute(
  patch: Partial<{
    passed: boolean;
    varianceAccepted: boolean;
    evidenceBlocked: boolean;
  }>,
  attemptCount = 1,
) {
  const latest = {
    attempt: attemptCount,
    markdown: "# PRD",
    reviewerScores: [],
    scoreSpread: 0,
    varianceAccepted: true,
    aggregate: {
      score: 70,
      passed: false,
      confidence: 0.8,
      rationale: "test",
      requiredRevisions: [],
      weights: {
        averageScore: 70,
        minimumScore: 70,
        spreadPenalty: 0,
        consistencyBonus: 0,
      },
    },
    passed: false,
    evidenceBlocked: false,
    evidenceBlockers: [],
    evidenceBlockerGroups: [],
    evidenceBlockerGroupingStatus: "grouped",
    selected: false,
    ...patch,
  };
  return selectNextNodeAfterScore({
    scoreAttempts: Array.from({ length: attemptCount }, (_, index) => ({
      ...latest,
      attempt: index + 1,
    })),
  } as never);
}

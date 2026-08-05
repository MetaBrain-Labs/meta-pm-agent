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
  isAcceptedDocumentEvidenceWorkflowResult,
  normalizeDocumentEvidenceResolution,
  selectNextNodeAfterScore,
  type DocumentEvidenceResolutionInput,
} from "../src";
import {
  createDocumentEvidenceResolutionPayload,
  createDocumentEvidenceResolverPrompt,
} from "../src/agents/product-workflow/orchestrator-agent/document-evidence-resolver-subagent/prompt";
import { createFormAnswerUserInputBlock } from "../src/agents/conversation/stream";
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

test("keeps trusted active Risk IDs and removes invented related nodes", () => {
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
          relatedNodeIds: ["RISK-1", "RISK-invented"],
        },
      ],
    },
    {
      ...input,
      knowledgeGraph: {
        ...input.knowledgeGraph,
        risks: [{ id: "RISK-1", text: "Certification is not confirmed." }],
      },
    },
  );

  assert.deepEqual(result.questions[0]?.relatedNodeIds, ["RISK-1"]);
});

test("injects every trusted blocker and the exact label contract into Resolver context", () => {
  const resolutionInput = {
    ...input,
    knowledgeGraph: {
      ...input.knowledgeGraph,
      risks: [{ id: "RISK-1", text: "Certification is not confirmed." }],
    },
  };
  const payload = createDocumentEvidenceResolutionPayload(resolutionInput);
  const prompt = createDocumentEvidenceResolverPrompt(resolutionInput);

  assert.deepEqual(payload.blockers, input.blockers);
  assert.equal(payload.knowledge_graph.risks[0]?.id, "RISK-1");
  assert.match(prompt, /Missing source citation/);
  assert.match(prompt, /"label":/);
  assert.match(prompt, /never "question"/);
  assert.match(prompt, /Never ask the user to restate, categorize, prioritize, map/);
  assert.match(prompt, /Do not ask which requirements, metrics, or decisions/);
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

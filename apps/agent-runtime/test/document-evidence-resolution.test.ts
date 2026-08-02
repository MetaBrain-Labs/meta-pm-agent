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
  normalizeDocumentEvidenceResolution,
  selectNextNodeAfterScore,
  type DocumentEvidenceResolutionInput,
} from "../src";
import {
  createDocumentEvidenceResolutionPayload,
  createDocumentEvidenceResolverPrompt,
} from "../src/agents/product-workflow/orchestrator-agent/document-evidence-resolver-subagent/prompt";
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
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    notes: [],
  },
};

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

test("injects every trusted blocker and the exact label contract into Resolver context", () => {
  const payload = createDocumentEvidenceResolutionPayload(input);
  const prompt = createDocumentEvidenceResolverPrompt(input);

  assert.deepEqual(payload.blockers, input.blockers);
  assert.match(prompt, /Missing source citation/);
  assert.match(prompt, /"label":/);
  assert.match(prompt, /never "question"/);
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

test("routes all five document scoring outcomes", () => {
  assert.equal(selectRoute({ passed: true }), "review");
  assert.equal(selectRoute({ varianceAccepted: false }), "retry");
  assert.equal(selectRoute({ evidenceBlocked: false }), "retry");
  assert.equal(selectRoute({ evidenceBlocked: true }), "export");
  assert.equal(selectRoute({ evidenceBlocked: true }, 3), "export");
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

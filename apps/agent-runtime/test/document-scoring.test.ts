/**
 * Document Agent PRD 评分门禁测试
 *
 * 验证 PRD 评分工作流中的纯函数决策，确保分差过大时不产生通过结果，并在
 * 多轮均未通过时按共识评分优先、分差次优先的规则选择最终草稿。
 *
 * Responsibilities:
 * - 验证分差不合格尝试会跳过共识评分并保持失败
 * - 验证最终选择优先使用已通过阈值的尝试
 * - 验证兜底选择按最高评分、最小分差排序
 *
 * Notes:
 * - 本测试不调用模型，只覆盖确定性评分辅助函数。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveJsonOutput } from "../src/agents/common/run-agent";
import {
  applyPrdCompletionGate,
  createDeterministicConsensusScore,
  createReviewerSourceLedger,
  DOCUMENT_SCORE_REVIEWERS,
  DOCUMENT_SCORE_MAX_SPREAD,
  DOCUMENT_REVIEWER_MODEL_OPTIONS,
  normalizeEvidenceBlockerGrouping,
  createSkippedConsensusScore,
  selectFinalScoreAttempt,
  shouldRetryDocumentScoreAttempt,
  validatePrdSourceGrounding,
  type DocumentScoreAttempt,
  type DocumentScoreReview,
} from "../src/agents/document-agent/scoring";

test("uses responsibility-based English reviewer names", () => {
  assert.deepEqual(
    DOCUMENT_SCORE_REVIEWERS.map((reviewer) => reviewer.name),
    [
      "Product Rationale & Evidence Reviewer",
      "Requirements & Acceptance Reviewer",
      "Scope & Delivery Readiness Reviewer",
    ],
  );
  assert.equal(DOCUMENT_REVIEWER_MODEL_OPTIONS.enableThinking, true);
  assert.equal(DOCUMENT_REVIEWER_MODEL_OPTIONS.maxTokens, 3072);
});

test("blocks PRDs with unresolved TBD evidence gaps from passing", () => {
  const blocked = applyPrdCompletionGate({
    markdown: "# PRD\n\nMetric target: [TBD — needs evidence]",
    score: 93,
  });
  const complete = applyPrdCompletionGate({
    markdown: "# PRD\n\nMetric target: 20%, source M-001",
    score: 93,
  });

  assert.deepEqual(blocked, { score: 84, blocked: true });
  assert.deepEqual(complete, { score: 93, blocked: false });
});

test("records high-spread attempts as failed without consensus pass", () => {
  const reviewerScores = [
    createReview("product-rationale-evidence-reviewer", 92),
    createReview("requirements-acceptance-reviewer", 71),
    createReview("scope-delivery-readiness-reviewer", 88),
  ];

  const aggregate = createSkippedConsensusScore({
    reviewerScores,
    scoreSpread: 21,
  });

  assert.equal(aggregate.passed, false);
  assert.match(aggregate.rationale, /consensus scoring was skipped/i);
  assert.equal(21 > DOCUMENT_SCORE_MAX_SPREAD, true);
});

test("stops for evidence gaps before retrying a failed draft", () => {
  assert.equal(
    shouldRetryDocumentScoreAttempt({
      attemptCount: 1,
      passed: false,
      evidenceBlocked: true,
    }),
    false,
  );
  assert.equal(
    shouldRetryDocumentScoreAttempt({
      attemptCount: 1,
      passed: false,
      evidenceBlocked: false,
    }),
    true,
  );
  assert.equal(
    shouldRetryDocumentScoreAttempt({
      attemptCount: 3,
      passed: false,
      evidenceBlocked: false,
    }),
    false,
  );
});

test("rejects unknown citations without line-level source status false positives", () => {
  const issues = validatePrdSourceGrounding({
    markdown: [
      "# PRD",
      "| Decision D-12345678 | Confirmed |",
      "Evidence: E-deadbeef",
    ].join("\n"),
    nodes: [
      {
        id: "D-12345678-0000-4000-8000-000000000000",
        type: "Decision",
        name: "Candidate scope",
        status: "proposed",
      },
    ],
    relations: [],
  });

  assert.equal(issues.length, 1);
  assert.match(issues.join("\n"), /unknown graph source ID E-deadbeef/);
  assert.doesNotMatch(issues.join("\n"), /D-12345678 is proposed/);
});

test("builds reviewer-specific source details plus a complete lightweight index", () => {
  const reviewer = DOCUMENT_SCORE_REVIEWERS.find(
    (item) => item.id === "requirements-acceptance-reviewer",
  );
  assert.ok(reviewer);

  const ledger = createReviewerSourceLedger({
    markdown: "# PRD\nEvidence E-12345678\nRequirement R-12345678",
    reviewer,
    sourceGraph: {
      nodes: [
        {
          id: "E-12345678-0000-4000-8000-000000000000",
          type: "Evidence",
          name: "Cited evidence",
          description: "Detailed cited evidence",
          status: "confirmed",
        },
        {
          id: "R-12345678-0000-4000-8000-000000000000",
          type: "Requirement",
          name: "Relevant requirement",
          description: "Detailed requirement",
          status: "confirmed",
        },
        {
          id: "M-12345678-0000-4000-8000-000000000000",
          type: "Metric",
          name: "Unrelated metric",
          description: "Large unrelated metric detail",
          status: "proposed",
        },
      ],
      relations: [],
    },
  });

  assert.equal(ledger.nodeIndex.length, 3);
  assert.equal("description" in ledger.nodeIndex[0]!, false);
  assert.deepEqual(
    ledger.nodes.map((node) => node.id),
    ["R-12345678"],
  );
});

test("keeps the 70/30 consensus score deterministic", () => {
  const reviewerScores = [
    createReview("product-rationale-evidence-reviewer", 90),
    createReview("requirements-acceptance-reviewer", 88),
    createReview("scope-delivery-readiness-reviewer", 87),
  ];
  const result = createDeterministicConsensusScore({
    markdown: "# PRD\nComplete and evidenced.",
    reviewerScores,
    scoreSpread: 3,
    blockingEvidenceIssues: [],
  });

  assert.equal(result.score, 88);
  assert.equal(result.passed, true);
  assert.equal(result.weights.minimumScore, 87);
});

test("consolidates 14 multilingual reviewer findings into traceable semantic groups", () => {
  const reviewerIds: DocumentScoreReview["reviewerId"][] = [
    "product-rationale-evidence-reviewer",
    "requirements-acceptance-reviewer",
    "scope-delivery-readiness-reviewer",
  ];
  const findings = Array.from({ length: 14 }, (_, index) => ({
    index,
    reviewerId: reviewerIds[index % reviewerIds.length]!,
    reviewerName: `Reviewer ${index % reviewerIds.length}`,
    text: `Raw blocker ${index}`,
  }));
  const modelOutput = {
    groups: [
      { title: "优先级", description: "需要确认优先级。", sourceIndexes: [0, 5, 9] },
      { title: "范围决策", description: "需要确认范围决策。", sourceIndexes: [1, 6, 10] },
      { title: "安全合规", description: "需要确认安全合规。", sourceIndexes: [2, 7, 11] },
      { title: "性能基线", description: "需要补充性能基线。", sourceIndexes: [3, 8, 12] },
      { title: "交付可行性", description: "需要确认交付可行性。", sourceIndexes: [4, 13] },
    ],
  };
  const resolution = resolveJsonOutput(
    {
      text: "",
      reasoningText: JSON.stringify(modelOutput),
      tokenUsage: null,
      maxTokens: 3_072,
    },
    {
      safeParse: (value) =>
        typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { groups?: unknown }).groups)
          ? { success: true as const, data: value }
          : { success: false as const, error: new Error("invalid grouping") },
    },
  );
  assert.equal(resolution.success, true);
  if (!resolution.success) return;

  const grouping = normalizeEvidenceBlockerGrouping(resolution.data, findings);

  assert.equal(grouping.status, "grouped");
  assert.equal(grouping.groups.length, 5);
  assert.equal(grouping.groups.flatMap((group) => group.sources).length, 14);
  assert.deepEqual(
    grouping.groups.flatMap((group) => group.sourceIndexes).sort((a, b) => a - b),
    findings.map((finding) => finding.index),
  );
});

test("falls back to one group per finding when semantic coverage is invalid", () => {
  const findings = [
    {
      index: 0,
      reviewerId: "product-rationale-evidence-reviewer" as const,
      reviewerName: "Reviewer A",
      text: "Missing priority",
    },
    {
      index: 1,
      reviewerId: "requirements-acceptance-reviewer" as const,
      reviewerName: "Reviewer B",
      text: "Missing baseline",
    },
  ];
  const grouping = normalizeEvidenceBlockerGrouping(
    {
      groups: [
        { title: "重复", description: "覆盖重复。", sourceIndexes: [0, 0] },
      ],
    },
    findings,
  );

  assert.equal(grouping.status, "fallback");
  assert.equal(grouping.groups.length, 2);
  assert.deepEqual(
    grouping.groups.map((group) => group.sourceIndexes),
    [[0], [1]],
  );
});

test("selects the first attempt that passed threshold", () => {
  const selected = selectFinalScoreAttempt([
    createAttempt(1, 82, 2, false),
    createAttempt(2, 86, 7, true),
    createAttempt(3, 90, 12, false),
  ]);

  assert.equal(selected?.attempt.attempt, 2);
  assert.equal(selected?.reason, "passed_threshold");
});

test("falls back to highest score before lowest spread after all attempts fail", () => {
  const selected = selectFinalScoreAttempt([
    createAttempt(1, 83, 2, false),
    createAttempt(2, 84, 12, false),
    createAttempt(3, 84, 6, false),
  ]);

  assert.equal(selected?.attempt.attempt, 3);
  assert.equal(selected?.reason, "highest_score_then_lowest_spread");
});

/**
 * 创建单个评分尝试。
 */
function createAttempt(
  attempt: number,
  aggregateScore: number,
  scoreSpread: number,
  passed: boolean,
): DocumentScoreAttempt {
  return {
    attempt,
    markdown: `# Draft ${attempt}`,
    reviewerScores: [
      createReview("product-rationale-evidence-reviewer", aggregateScore),
      createReview(
        "requirements-acceptance-reviewer",
        aggregateScore - scoreSpread,
      ),
      createReview("scope-delivery-readiness-reviewer", aggregateScore),
    ],
    scoreSpread,
    varianceAccepted: scoreSpread <= DOCUMENT_SCORE_MAX_SPREAD,
    aggregate: {
      score: aggregateScore,
      passed,
      confidence: 0.8,
      rationale: "test",
      requiredRevisions: [],
      weights: {
        averageScore: aggregateScore,
        minimumScore: aggregateScore - scoreSpread,
        spreadPenalty: 0,
        consistencyBonus: 0,
      },
    },
    passed,
    evidenceBlocked: false,
    evidenceBlockers: [],
    evidenceBlockerGroups: [],
    evidenceBlockerGroupingStatus: "grouped",
    selected: false,
  };
}

/**
 * 创建单个模拟评分报告。
 */
function createReview(
  reviewerId: DocumentScoreReview["reviewerId"],
  score: number,
): DocumentScoreReview {
  return {
    reviewerId,
    reviewerName: reviewerId,
    score,
    dimensions: {
      relevance: score,
      completeness: score,
      structure: score,
      feasibility: score,
      language: score,
    },
    strengths: [],
    weaknesses: [],
    revisionAdvice: ["Improve PRD evidence."],
    evidenceBlocked: false,
    evidenceBlockers: [],
  };
}

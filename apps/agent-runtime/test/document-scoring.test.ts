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
import {
  DOCUMENT_SCORE_MAX_SPREAD,
  createSkippedConsensusScore,
  selectFinalScoreAttempt,
  type DocumentScoreAttempt,
  type DocumentScoreReview,
} from "../src/agents/document-agent/scoring";

test("records high-spread attempts as failed without consensus pass", () => {
  const reviewerScores = [
    createReview("gaokao-reviewer-a", 92),
    createReview("gaokao-reviewer-b", 71),
    createReview("gaokao-reviewer-c", 88),
  ];

  const aggregate = createSkippedConsensusScore({
    reviewerScores,
    scoreSpread: 21,
  });

  assert.equal(aggregate.passed, false);
  assert.match(aggregate.rationale, /consensus scoring was skipped/i);
  assert.equal(21 > DOCUMENT_SCORE_MAX_SPREAD, true);
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
      createReview("gaokao-reviewer-a", aggregateScore),
      createReview("gaokao-reviewer-b", aggregateScore - scoreSpread),
      createReview("gaokao-reviewer-c", aggregateScore),
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
  };
}

/**
 * Document Agent 评分执行器
 *
 * 为 PRD 草稿提供独立质量门禁：三位评分 Agent 按中国高考语文作文阅卷模式独立打分，
 * 再由加权评分 Agent 汇总。评分偏差过大或总分低于阈值时，文档工作流会触发重写重试。
 *
 * Responsibilities:
 * - runPrdScoringReviewers()：运行三位独立评分 Agent
 * - runPrdWeightedScoringAgent()：运行加权汇总评分 Agent
 * - 提供评分阈值、最大偏差、最大重试次数与确定性回退
 *
 * Notes:
 * - 本文件的模型可见提示词必须保持英文。
 */

import { z } from "zod";
import type { DocumentSectionDraft } from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
  type JsonAgentEvent,
} from "../common/run-json-agent";
import {
  PRD_GAOKAO_SCORING_AGENT_PROMPT,
  PRD_WEIGHTED_SCORING_AGENT_PROMPT,
} from "./prompt";

export const DOCUMENT_SCORE_THRESHOLD = 85;
export const DOCUMENT_SCORE_MAX_SPREAD = 8;
export const DOCUMENT_SCORE_MAX_ATTEMPTS = 3;

export type DocumentScoreAgentType = "document-score";

export type DocumentScoringStreamEvent = JsonAgentEvent<DocumentScoreAgentType>;

export type DocumentScoringReviewerId =
  | "gaokao-reviewer-a"
  | "gaokao-reviewer-b"
  | "gaokao-reviewer-c";

/**
 * 单个评分 Agent 的结构化评分结果。
 */
export interface DocumentScoreReview {
  reviewerId: DocumentScoringReviewerId;
  reviewerName: string;
  score: number;
  dimensions: {
    relevance: number;
    completeness: number;
    structure: number;
    feasibility: number;
    language: number;
  };
  strengths: string[];
  weaknesses: string[];
  revisionAdvice: string[];
}

/**
 * 加权评分 Agent 的结构化汇总结果。
 */
export interface DocumentWeightedScore {
  score: number;
  passed: boolean;
  confidence: number;
  rationale: string;
  requiredRevisions: string[];
  weights: {
    averageScore: number;
    minimumScore: number;
    spreadPenalty: number;
    consistencyBonus: number;
  };
}

/**
 * 单轮评分尝试。
 */
export interface DocumentScoreAttempt {
  attempt: number;
  markdown: string;
  reviewerScores: DocumentScoreReview[];
  scoreSpread: number;
  varianceAccepted: boolean;
  aggregate: DocumentWeightedScore;
  passed: boolean;
  selected: boolean;
}

/**
 * 最终评分选择结果。
 */
export interface DocumentScoreSelection {
  attempt: DocumentScoreAttempt;
  reason: "passed_threshold" | "lowest_spread" | "highest_score";
}

const ReviewerScoreSchema = z.object({
  score: z.number().min(0).max(100),
  dimensions: z.object({
    relevance: z.number().min(0).max(100),
    completeness: z.number().min(0).max(100),
    structure: z.number().min(0).max(100),
    feasibility: z.number().min(0).max(100),
    language: z.number().min(0).max(100),
  }),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  revisionAdvice: z.array(z.string()).default([]),
});

const WeightedScoreSchema = z.object({
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  requiredRevisions: z.array(z.string()).default([]),
  weights: z.object({
    averageScore: z.number().min(0).max(100),
    minimumScore: z.number().min(0).max(100),
    spreadPenalty: z.number().min(0),
    consistencyBonus: z.number().min(0),
  }),
});

const REVIEWERS: Array<{
  id: DocumentScoringReviewerId;
  name: string;
  profile: string;
}> = [
  {
    id: "gaokao-reviewer-a",
    name: "Gaokao Reviewer A",
    profile:
      "Strict first reviewer. Prioritize requirement completeness, evidence grounding, and whether the PRD answers the core product problem.",
  },
  {
    id: "gaokao-reviewer-b",
    name: "Gaokao Reviewer B",
    profile:
      "Structure-focused second reviewer. Prioritize clear hierarchy, acceptance criteria, dependencies, and logical consistency across sections.",
  },
  {
    id: "gaokao-reviewer-c",
    name: "Gaokao Reviewer C",
    profile:
      "Practicality-focused third reviewer. Prioritize feasibility, implementation readiness, measurable metrics, and risk disclosure.",
  },
];

/**
 * 运行三位独立评分 Agent。
 */
export async function runPrdScoringReviewers({
  markdown,
  sections,
  attempt,
  signal,
  onEvent,
}: {
  markdown: string;
  sections: DocumentSectionDraft[];
  attempt: number;
  signal?: AbortSignal;
  onEvent?: (event: DocumentScoringStreamEvent) => void;
}): Promise<DocumentScoreReview[]> {
  const reviews: DocumentScoreReview[] = [];

  for (const reviewer of REVIEWERS) {
    const stream = runJsonAgent({
      agentType: "document-score",
      agentLabel: reviewer.name,
      name: `document-${reviewer.id}`,
      systemPrompt: PRD_GAOKAO_SCORING_AGENT_PROMPT,
      modelOptions: {
        ...JSON_AGENT_MODEL_OPTIONS,
        maxTokens: 4096,
      },
      payload: {
        reviewer,
        attempt,
        scoringScale: "0-100",
        markdown,
        sections,
      },
      schema: ReviewerScoreSchema,
      fallback: (reason) =>
        createReviewerFallback({
          reviewer,
          markdown,
          sections,
          reason,
        }),
      signal,
      suppressInvalidJsonReasoning: true,
    });

    const parsed = await consumeJsonAgentStream(stream, onEvent);
    reviews.push({
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      score: clampScore(parsed.score),
      dimensions: {
        relevance: clampScore(parsed.dimensions.relevance),
        completeness: clampScore(parsed.dimensions.completeness),
        structure: clampScore(parsed.dimensions.structure),
        feasibility: clampScore(parsed.dimensions.feasibility),
        language: clampScore(parsed.dimensions.language),
      },
      strengths: parsed.strengths.slice(0, 6),
      weaknesses: parsed.weaknesses.slice(0, 6),
      revisionAdvice: parsed.revisionAdvice.slice(0, 8),
    });
  }

  return reviews;
}

/**
 * 运行加权汇总评分 Agent，并由代码层强制执行阈值与偏差规则。
 */
export async function runPrdWeightedScoringAgent({
  markdown,
  reviewerScores,
  scoreSpread,
  varianceAccepted,
  attempt,
  signal,
  onEvent,
}: {
  markdown: string;
  reviewerScores: DocumentScoreReview[];
  scoreSpread: number;
  varianceAccepted: boolean;
  attempt: number;
  signal?: AbortSignal;
  onEvent?: (event: DocumentScoringStreamEvent) => void;
}): Promise<DocumentWeightedScore> {
  const stream = runJsonAgent({
    agentType: "document-score",
    agentLabel: "Document Weighted Scoring Agent",
    name: "document-weighted-scoring-agent",
    systemPrompt: PRD_WEIGHTED_SCORING_AGENT_PROMPT,
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      // 加权评分需要综合三方分歧和修订项，使用与单评审一致的 4k 结构化输出预算。
      maxTokens: 4096,
    },
    payload: {
      attempt,
      threshold: DOCUMENT_SCORE_THRESHOLD,
      maxAllowedScoreSpread: DOCUMENT_SCORE_MAX_SPREAD,
      scoreSpread,
      varianceAccepted,
      reviewerScores,
      markdown,
    },
    schema: WeightedScoreSchema,
    fallback: (reason) =>
      createWeightedFallback({
        reviewerScores,
        scoreSpread,
        varianceAccepted,
        reason,
      }),
    signal,
    suppressInvalidJsonReasoning: true,
  });

  const parsed = await consumeJsonAgentStream(stream, onEvent);
  const score = clampScore(parsed.score);

  return {
    score,
    passed: varianceAccepted && score >= DOCUMENT_SCORE_THRESHOLD,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    rationale: parsed.rationale,
    requiredRevisions: parsed.requiredRevisions.slice(0, 10),
    weights: {
      averageScore: clampScore(parsed.weights.averageScore),
      minimumScore: clampScore(parsed.weights.minimumScore),
      spreadPenalty: Math.max(0, parsed.weights.spreadPenalty),
      consistencyBonus: Math.max(0, parsed.weights.consistencyBonus),
    },
  };
}

/**
 * 根据三位评分 Agent 的一致性结果生成直接评分。
 */
export function createReviewerConsensusScore({
  reviewerScores,
  scoreSpread,
}: {
  reviewerScores: DocumentScoreReview[];
  scoreSpread: number;
}): DocumentWeightedScore {
  const scores = reviewerScores.map((review) => review.score);
  const averageScore =
    scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  const minimumScore = scores.length > 0 ? Math.min(...scores) : 0;
  const consistencyBonus = scoreSpread <= DOCUMENT_SCORE_MAX_SPREAD ? 1 : 0;
  const score = clampScore(
    averageScore * 0.82 + minimumScore * 0.18 + consistencyBonus,
  );
  const requiredRevisions = Array.from(
    new Set(
      reviewerScores
        .flatMap((review) => review.revisionAdvice)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);

  return {
    score,
    passed: score >= DOCUMENT_SCORE_THRESHOLD,
    confidence: scoreSpread <= DOCUMENT_SCORE_MAX_SPREAD ? 0.86 : 0.5,
    rationale:
      scoreSpread <= DOCUMENT_SCORE_MAX_SPREAD
        ? "Reviewer scores are within the allowed spread, so the workflow used direct reviewer consensus without invoking the weighted scoring agent."
        : "Reviewer scores exceed the allowed spread and require weighted aggregation.",
    requiredRevisions:
      score >= DOCUMENT_SCORE_THRESHOLD
        ? []
        : requiredRevisions.length > 0
          ? requiredRevisions
          : ["Raise the PRD above the quality threshold before final export."],
    weights: {
      averageScore,
      minimumScore,
      spreadPenalty: 0,
      consistencyBonus,
    },
  };
}

/**
 * 计算评分偏差范围。
 */
export function calculateScoreSpread(reviews: DocumentScoreReview[]): number {
  if (reviews.length === 0) return 100;
  const scores = reviews.map((review) => review.score);
  return Math.max(...scores) - Math.min(...scores);
}

/**
 * 从评分历史中选择最终可导出的尝试。
 */
export function selectFinalScoreAttempt(
  attempts: DocumentScoreAttempt[],
): DocumentScoreSelection | null {
  const passed = attempts.find((attempt) => attempt.passed);
  if (passed) return { attempt: passed, reason: "passed_threshold" };

  const reliableAttempts = attempts.filter(
    (attempt) => attempt.varianceAccepted,
  );
  if (reliableAttempts.length > 0) {
    return {
      attempt: [...reliableAttempts].sort(
        (a, b) => b.aggregate.score - a.aggregate.score,
      )[0]!,
      reason: "highest_score",
    };
  }

  const lowestSpread = [...attempts].sort((a, b) => {
    if (a.scoreSpread !== b.scoreSpread) return a.scoreSpread - b.scoreSpread;
    return b.aggregate.score - a.aggregate.score;
  })[0];

  return lowestSpread
    ? { attempt: lowestSpread, reason: "lowest_spread" }
    : null;
}

/**
 * 根据失败评分生成下一轮重写反馈。
 */
export function createScoreRetryFeedback(
  attempt: DocumentScoreAttempt,
): string {
  const revisionAdvice = [
    ...attempt.aggregate.requiredRevisions,
    ...attempt.reviewerScores.flatMap((review) => review.revisionAdvice),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const uniqueAdvice = Array.from(new Set(revisionAdvice)).slice(0, 10);

  return [
    `Previous PRD scoring attempt ${attempt.attempt} did not pass.`,
    `Weighted score: ${attempt.aggregate.score}/${DOCUMENT_SCORE_THRESHOLD}.`,
    `Reviewer score spread: ${attempt.scoreSpread}/${DOCUMENT_SCORE_MAX_SPREAD}.`,
    attempt.varianceAccepted
      ? "Reviewer scores are within the allowed spread, but the weighted score is still below threshold."
      : "Reviewer scores exceed the allowed spread, so the draft must be regenerated and made less ambiguous.",
    "Revise the PRD to address these issues:",
    ...uniqueAdvice.map((item) => `- ${item}`),
  ].join("\n");
}

/**
 * 消费 JSON Agent 流并透传事件。
 */
async function consumeJsonAgentStream<T>(
  stream: AsyncGenerator<DocumentScoringStreamEvent, T, void>,
  onEvent?: (event: DocumentScoringStreamEvent) => void,
): Promise<T> {
  let next = await stream.next();
  while (!next.done) {
    onEvent?.(next.value);
    next = await stream.next();
  }
  return next.value;
}

/**
 * 创建单个评分 Agent 的确定性回退结果。
 */
function createReviewerFallback({
  reviewer,
  markdown,
  sections,
  reason,
}: {
  reviewer: (typeof REVIEWERS)[number];
  markdown: string;
  sections: DocumentSectionDraft[];
  reason: string;
}): z.infer<typeof ReviewerScoreSchema> {
  const hasRisk = /风险|risk/i.test(markdown);
  const hasMetric = /指标|metric|success/i.test(markdown);
  const hasAcceptance = /验收|acceptance/i.test(markdown);
  const baseScore = Math.min(
    88,
    62 +
      Math.min(12, sections.length * 2) +
      (hasRisk ? 5 : 0) +
      (hasMetric ? 5 : 0) +
      (hasAcceptance ? 4 : 0),
  );

  return {
    score: baseScore,
    dimensions: {
      relevance: baseScore,
      completeness: hasAcceptance ? baseScore : baseScore - 6,
      structure: sections.length >= 6 ? baseScore : baseScore - 5,
      feasibility: hasRisk ? baseScore : baseScore - 6,
      language: Math.min(92, baseScore + 3),
    },
    strengths: ["The draft contains a usable PRD structure."],
    weaknesses: [
      `Fallback scoring used because ${reviewer.name} failed: ${reason}`,
    ],
    revisionAdvice: [
      "Strengthen evidence links to knowledge graph nodes.",
      "Make acceptance criteria and measurable success metrics explicit.",
      "Clarify risks, dependencies, and implementation constraints.",
    ],
  };
}

/**
 * 创建加权评分 Agent 的确定性回退结果。
 */
function createWeightedFallback({
  reviewerScores,
  scoreSpread,
  varianceAccepted,
  reason,
}: {
  reviewerScores: DocumentScoreReview[];
  scoreSpread: number;
  varianceAccepted: boolean;
  reason: string;
}): z.infer<typeof WeightedScoreSchema> {
  const scores = reviewerScores.map((review) => review.score);
  const averageScore =
    scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  const minimumScore = scores.length > 0 ? Math.min(...scores) : 0;
  const spreadPenalty = Math.max(0, scoreSpread - 4) * 1.5;
  const consistencyBonus = varianceAccepted ? 2 : 0;
  const score = clampScore(
    averageScore * 0.72 +
      minimumScore * 0.18 +
      consistencyBonus -
      spreadPenalty,
  );

  return {
    score,
    confidence: varianceAccepted ? 0.72 : 0.48,
    rationale:
      "Weighted scoring was completed by the deterministic backup scorer because the weighted scoring agent did not return a valid structured result.",
    requiredRevisions: [
      "Address the lowest scoring reviewer comments first.",
      "Reduce reviewer disagreement by making requirements more concrete and evidence-backed.",
      "Improve PRD completeness before final export.",
    ],
    weights: {
      averageScore,
      minimumScore,
      spreadPenalty,
      consistencyBonus,
    },
  };
}

/**
 * 将分数限制在 0-100。
 */
function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

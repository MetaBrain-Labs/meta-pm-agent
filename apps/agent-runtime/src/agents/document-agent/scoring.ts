/**
 * Document Agent 评分执行器
 *
 * 为 PRD 草稿提供独立质量门禁：三位评分 Agent 按中国高考语文作文阅卷模式独立打分。
 * 只有三方分差不超过阈值时，才进入共识评分；分差过大时直接记录失败并触发重写重试。
 *
 * Responsibilities:
 * - runPrdScoringReviewers()：运行三位独立评分 Agent
 * - runPrdWeightedScoringAgent()：运行分差合格后的共识评分 Agent
 * - 提供评分阈值、最大偏差、最大重试次数与确定性回退
 *
 * Notes:
 * - 本文件的模型可见提示词必须保持英文。
 */

import { z } from "zod";
import type { DocumentSectionDraft } from "@repo/shared";
import {
  type AgentRunEvent,
  JSON_AGENT_MODEL_OPTIONS,
  resolveJsonOutput,
  runAgent,
} from "../common/run-agent";
import {
  PRD_GAOKAO_SCORING_AGENT_PROMPT,
  PRD_WEIGHTED_SCORING_AGENT_PROMPT,
} from "./prompt";

export const DOCUMENT_SCORE_THRESHOLD = 85;
export const DOCUMENT_SCORE_MAX_SPREAD = 8;
export const DOCUMENT_SCORE_MAX_ATTEMPTS = 3;

export type DocumentScoreAgentType = "document-score";

export type DocumentScoringStreamEvent = AgentRunEvent<DocumentScoreAgentType>;

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
 * 共识评分 Agent 的结构化汇总结果。
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
  reason:
    | "passed_threshold"
    | "lowest_spread"
    | "highest_score"
    | "highest_score_then_lowest_spread";
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
      "Why-and-evidence reviewer. Prioritize why the work matters, the problem and target users, business value, source-node traceability, and whether facts or priorities were invented.",
  },
  {
    id: "gaokao-reviewer-b",
    name: "Gaokao Reviewer B",
    profile:
      "Cross-functional specification reviewer. Prioritize functional coverage, user experience, stable requirement IDs, P0 or high-risk Given/When/Then acceptance criteria, edge cases, and clarity for product, design, engineering, and QA.",
  },
  {
    id: "gaokao-reviewer-c",
    name: "Gaokao Reviewer C",
    profile:
      "Scope-and-readiness reviewer. Prioritize scope and priority, measurable outcomes, dependencies, constraints, risks, validation, business usability, and whether the document defines the required degree of completion.",
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
    const stream = runAgent({
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
      resolveOutput: (context) =>
        resolveJsonOutput(context, ReviewerScoreSchema),
      fallback: (reason) =>
        createReviewerFallback({
          reviewer,
          markdown,
          sections,
          reason,
        }),
      signal,
      suppressFallbackReasoning: true,
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
 * 运行分差合格后的共识评分 Agent，并由代码层强制执行阈值与偏差规则。
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
  const stream = runAgent({
    agentType: "document-score",
    agentLabel: "Document Weighted Scoring Agent",
    name: "document-weighted-scoring-agent",
    systemPrompt: PRD_WEIGHTED_SCORING_AGENT_PROMPT,
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      // 共识评分需要综合三方分歧和修订项，使用与单评审一致的 4k 结构化输出预算。
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
    resolveOutput: (context) =>
      resolveJsonOutput(context, WeightedScoreSchema),
    fallback: (reason) =>
      createWeightedFallback({
        reviewerScores,
        scoreSpread,
        varianceAccepted,
        reason,
      }),
    signal,
    suppressFallbackReasoning: true,
  });

  const parsed = await consumeJsonAgentStream(stream, onEvent);
  const completionGate = applyPrdCompletionGate({
    markdown,
    score: clampScore(parsed.score),
  });
  const requiredRevisions = parsed.requiredRevisions.slice(0, 10);
  if (completionGate.blocked) {
    requiredRevisions.unshift(
      "Resolve every TBD evidence gap before the PRD can pass quality review.",
    );
  }

  return {
    score: completionGate.score,
    passed:
      varianceAccepted &&
      !completionGate.blocked &&
      completionGate.score >= DOCUMENT_SCORE_THRESHOLD,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    rationale: completionGate.blocked
      ? `${parsed.rationale} The deterministic completion gate found unresolved TBD evidence gaps.`
      : parsed.rationale,
    requiredRevisions: Array.from(new Set(requiredRevisions)).slice(0, 10),
    weights: {
      averageScore: clampScore(parsed.weights.averageScore),
      minimumScore: clampScore(parsed.weights.minimumScore),
      spreadPenalty: Math.max(0, parsed.weights.spreadPenalty),
      consistencyBonus: Math.max(0, parsed.weights.consistencyBonus),
    },
  };
}

/**
 * 对明确标记为 TBD 的未决事实执行确定性完成门禁。
 */
export function applyPrdCompletionGate({
  markdown,
  score,
}: {
  markdown: string;
  score: number;
}): {
  score: number;
  blocked: boolean;
} {
  const blocked = /\bTBD\b/i.test(markdown);
  return {
    score: blocked
      ? Math.min(clampScore(score), DOCUMENT_SCORE_THRESHOLD - 1)
      : clampScore(score),
    blocked,
  };
}

/**
 * 为分差不合格的草稿记录保守评分，不触发共识评分 Agent。
 */
export function createSkippedConsensusScore({
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
  const spreadPenalty = Math.max(0, scoreSpread - DOCUMENT_SCORE_MAX_SPREAD) * 2;
  const score = clampScore(
    averageScore * 0.7 + minimumScore * 0.3 - spreadPenalty,
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
    passed: false,
    confidence: 0.42,
    rationale:
      "Reviewer score spread exceeds the allowed limit, so consensus scoring was skipped. This conservative score is stored only for retry and fallback selection.",
    requiredRevisions:
      requiredRevisions.length > 0
        ? requiredRevisions
        : [
            "Reduce reviewer disagreement by making requirements more concrete, evidence-backed, and internally consistent.",
          ],
    weights: {
      averageScore,
      minimumScore,
      spreadPenalty,
      consistencyBonus: 0,
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

  const highestScoreThenLowestSpread = [...attempts].sort((a, b) => {
    if (a.aggregate.score !== b.aggregate.score) {
      return b.aggregate.score - a.aggregate.score;
    }
    if (a.scoreSpread !== b.scoreSpread) return a.scoreSpread - b.scoreSpread;
    // 稳定选择更早生成的草稿，避免同分同分差时最终版本来回变化。
    return a.attempt - b.attempt;
  })[0];

  return highestScoreThenLowestSpread
    ? {
        attempt: highestScoreThenLowestSpread,
        reason: "highest_score_then_lowest_spread",
      }
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
    `Consensus score: ${attempt.aggregate.score}/${DOCUMENT_SCORE_THRESHOLD}.`,
    `Reviewer score spread: ${attempt.scoreSpread}/${DOCUMENT_SCORE_MAX_SPREAD}.`,
    attempt.varianceAccepted
      ? "Reviewer scores are within the allowed spread, but the consensus score is still below threshold."
      : "Reviewer scores exceed the allowed spread, so consensus scoring was skipped and the draft must be regenerated.",
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
 * 创建共识评分 Agent 的确定性回退结果。
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

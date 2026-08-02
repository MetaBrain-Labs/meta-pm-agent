/**
 * Document Agent 评分执行器
 *
 * 为 PRD 草稿提供独立质量门禁：三位职责明确的评分 Agent 按统一量表独立打分。
 * 只有三方分差不超过阈值时，才进入确定性共识评分；分差过大时直接记录失败并触发重写重试。
 *
 * Responsibilities:
 * - runPrdScoringReviewers()：运行三位独立评分 Agent
 * - createDeterministicConsensusScore()：汇总分差合格后的三方评分
 * - 提供评分阈值、最大偏差、最大重试次数与确定性回退
 *
 * Notes:
 * - 本文件的模型可见提示词必须保持英文。
 */

import { z } from "zod";
import type {
  DocumentSectionDraft,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  ModelUsageProfile,
} from "@repo/shared";
import {
  type AgentRunEvent,
  JSON_AGENT_MODEL_OPTIONS,
  resolveJsonOutput,
  runAgent,
} from "../common/run-agent";
import { PRD_SCORING_REVIEWER_PROMPT } from "./prompt";

export const DOCUMENT_SCORE_THRESHOLD = 85;
export const DOCUMENT_SCORE_MAX_SPREAD = 8;
export const DOCUMENT_SCORE_MAX_ATTEMPTS = 3;
export const DOCUMENT_REVIEWER_MODEL_OPTIONS = {
  ...JSON_AGENT_MODEL_OPTIONS,
  enableThinking: false,
  maxTokens: 3072,
} as const;

export type DocumentScoreAgentType = "document-score";

export type DocumentScoringStreamEvent = AgentRunEvent<DocumentScoreAgentType>;

export type DocumentScoringReviewerId =
  | "product-rationale-evidence-reviewer"
  | "requirements-acceptance-reviewer"
  | "scope-delivery-readiness-reviewer";

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
  evidenceBlocked: boolean;
  evidenceBlockers: string[];
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
  evidenceBlocked: boolean;
  evidenceBlockers: string[];
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
  evidenceBlocked: z.boolean().default(false),
  evidenceBlockers: z.array(z.string()).default([]),
});

export const DOCUMENT_SCORE_REVIEWERS: Array<{
  id: DocumentScoringReviewerId;
  name: string;
  profile: string;
  relevantTypes: KnowledgeGraphEntity["type"][];
}> = [
  {
    id: "product-rationale-evidence-reviewer",
    name: "Product Rationale & Evidence Reviewer",
    profile:
      "Why-and-evidence reviewer. Prioritize why the work matters, the problem and target users, business value, source-node traceability, and whether facts or priorities were invented.",
    relevantTypes: ["Goal", "Evidence", "Decision", "Metric"],
  },
  {
    id: "requirements-acceptance-reviewer",
    name: "Requirements & Acceptance Reviewer",
    profile:
      "Cross-functional specification reviewer. Prioritize functional coverage, user experience, stable requirement IDs, P0 or high-risk Given/When/Then acceptance criteria, edge cases, and clarity for product, design, engineering, and QA.",
    relevantTypes: ["Requirement", "Feature", "Component"],
  },
  {
    id: "scope-delivery-readiness-reviewer",
    name: "Scope & Delivery Readiness Reviewer",
    profile:
      "Scope-and-readiness reviewer. Prioritize scope and priority, measurable outcomes, dependencies, constraints, risks, validation, business usability, and whether the document defines the required degree of completion.",
    relevantTypes: [
      "Goal",
      "Decision",
      "Metric",
      "Requirement",
      "Component",
      "Custom",
    ],
  },
];

/**
 * 运行三位独立评分 Agent。
 */
export async function runPrdScoringReviewers({
  markdown,
  sections,
  sourceGraph,
  sourceGroundingIssues,
  attempt,
  modelProfile,
  signal,
  onEvent,
}: {
  markdown: string;
  sections: DocumentSectionDraft[];
  sourceGraph: {
    nodes: KnowledgeGraphEntity[];
    relations: KnowledgeGraphRelation[];
  };
  sourceGroundingIssues: string[];
  attempt: number;
  modelProfile?: ModelUsageProfile;
  signal?: AbortSignal;
  onEvent?: (event: DocumentScoringStreamEvent) => void;
}): Promise<DocumentScoreReview[]> {
  return Promise.all(
    DOCUMENT_SCORE_REVIEWERS.map(async (reviewer) => {
      const stream = runAgent({
        agentType: "document-score",
        agentLabel: reviewer.name,
        name: `document-${reviewer.id}`,
        systemPrompt: PRD_SCORING_REVIEWER_PROMPT,
        modelOptions: DOCUMENT_REVIEWER_MODEL_OPTIONS,
        modelProfile,
        modelGroup: "document",
        payload: {
          attempt,
          scoringScale: "0-100",
          markdown,
          sections,
          sourceGroundingIssues,
          sourceLedger: createReviewerSourceLedger({
            markdown,
            sourceGraph,
            reviewer,
          }),
          reviewer,
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
      return {
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
        strengths: parsed.strengths,
        weaknesses: parsed.weaknesses,
        revisionAdvice: parsed.revisionAdvice,
        evidenceBlocked: parsed.evidenceBlocked,
        evidenceBlockers: parsed.evidenceBlockers,
      };
    }),
  );
}

/**
 * 通过固定权重汇总三方评分，避免重复调用模型解释 Reviewer 已给出的结论。
 */
export function createDeterministicConsensusScore({
  markdown,
  reviewerScores,
  scoreSpread,
  blockingEvidenceIssues,
}: {
  markdown: string;
  reviewerScores: DocumentScoreReview[];
  scoreSpread: number;
  blockingEvidenceIssues: string[];
}): DocumentWeightedScore {
  const scores = reviewerScores.map((review) => review.score);
  const averageScore =
    scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  const minimumScore = scores.length > 0 ? Math.min(...scores) : 0;
  const baseScore = clampScore(averageScore * 0.7 + minimumScore * 0.3);
  const completionGate = applyPrdCompletionGate({
    markdown,
    score: baseScore,
    blockingEvidenceIssues,
  });
  const requiredRevisions = Array.from(
    new Set(
      [
        ...blockingEvidenceIssues,
        ...reviewerScores.flatMap((review) => review.revisionAdvice),
      ]
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);
  if (completionGate.blocked) {
    requiredRevisions.unshift(
      "Keep unsupported facts as TBD and obtain new graph evidence before quality approval.",
    );
  }

  return {
    score: completionGate.score,
    passed:
      !completionGate.blocked &&
      completionGate.score >= DOCUMENT_SCORE_THRESHOLD,
    confidence: 0.72,
    rationale: completionGate.blocked
      ? "The deterministic consensus score is below approval because unresolved evidence or source-grounding gaps remain."
      : "The deterministic consensus score weights the reviewer average at 70% and the strictest reviewer at 30%.",
    requiredRevisions: Array.from(new Set(requiredRevisions)).slice(0, 10),
    weights: {
      averageScore,
      minimumScore,
      spreadPenalty: 0,
      consistencyBonus: 0,
    },
  };
}

/**
 * 对明确标记为 TBD 的未决事实执行确定性完成门禁。
 */
export function applyPrdCompletionGate({
  markdown,
  score,
  blockingEvidenceIssues = [],
}: {
  markdown: string;
  score: number;
  blockingEvidenceIssues?: string[];
}): {
  score: number;
  blocked: boolean;
} {
  const blocked =
    /\bTBD\b/i.test(markdown) || blockingEvidenceIssues.length > 0;
  return {
    score: blocked
      ? Math.min(clampScore(score), DOCUMENT_SCORE_THRESHOLD - 1)
      : clampScore(score),
    blocked,
  };
}

/**
 * 检查 PRD 中可确定验证的图谱引用，不执行自然语言状态判断。
 */
export function validatePrdSourceGrounding({
  markdown,
  nodes,
  relations,
}: {
  markdown: string;
  nodes: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
}): string[] {
  const graphItems = [...nodes, ...relations];
  const knownIds = new Set(
    graphItems.map((item) => shortenGraphId(item.id).toUpperCase()),
  );
  const issues: string[] = [];
  const citedIds = markdown.match(
    /\b(?:G|E|R|F|D|M|CUS|COMP|REL|RISK)-[0-9a-f]{8}\b/gi,
  );

  for (const citedId of new Set(citedIds ?? [])) {
    if (!knownIds.has(citedId.toUpperCase())) {
      issues.push(`PRD cites unknown graph source ID ${citedId}.`);
    }
  }

  return Array.from(new Set(issues));
}

/**
 * 判断失败草稿能否仅靠现有图谱重写；证据阻塞时直接导出草案等待补充。
 */
export function shouldRetryDocumentScoreAttempt({
  attemptCount,
  passed,
  varianceAccepted,
  evidenceBlocked,
}: {
  attemptCount: number;
  passed: boolean;
  varianceAccepted: boolean;
  evidenceBlocked: boolean;
}): boolean {
  if (passed || attemptCount >= DOCUMENT_SCORE_MAX_ATTEMPTS) return false;
  if (!varianceAccepted) return true;
  return !evidenceBlocked;
}

/**
 * 为分差不合格的草稿记录保守评分，不触发共识评分 Agent。
 */
export function createSkippedConsensusScore({
  reviewerScores,
  scoreSpread,
  sourceGroundingIssues = [],
}: {
  reviewerScores: DocumentScoreReview[];
  scoreSpread: number;
  sourceGroundingIssues?: string[];
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
      [
        ...sourceGroundingIssues,
        ...reviewerScores.flatMap((review) => review.revisionAdvice),
      ]
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
  reviewer: (typeof DOCUMENT_SCORE_REVIEWERS)[number];
  markdown: string;
  sections: DocumentSectionDraft[];
  reason: string;
}): z.infer<typeof ReviewerScoreSchema> {
  const hasRisk = /风险|risk/i.test(markdown);
  const hasMetric = /指标|metric|success/i.test(markdown);
  const hasAcceptance = /验收|acceptance/i.test(markdown);
  const baseScore = Math.min(
    74,
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
    evidenceBlocked: false,
    evidenceBlockers: [],
  };
}

/**
 * 为单个 Reviewer 构造轻量全图索引和职责相关的详细事实。
 */
export function createReviewerSourceLedger({
  markdown,
  sourceGraph,
  reviewer,
}: {
  markdown: string;
  sourceGraph: {
    nodes: KnowledgeGraphEntity[];
    relations: KnowledgeGraphRelation[];
  };
  reviewer: (typeof DOCUMENT_SCORE_REVIEWERS)[number];
}) {
  const citedIds = new Set(
    (markdown.match(
      /\b(?:G|E|R|F|D|M|CUS|COMP|REL|RISK)-[0-9a-f]{8}\b/gi,
    ) ?? []).map((id) => id.toUpperCase()),
  );
  const detailedNodes = sourceGraph.nodes.filter(
    (node) =>
      citedIds.has(shortenGraphId(node.id).toUpperCase()) &&
      reviewer.relevantTypes.includes(node.type),
  );
  const detailedNodeIds = new Set(detailedNodes.map((node) => node.id));
  const detailedRelations = sourceGraph.relations.filter(
    (relation) =>
      detailedNodeIds.has(relation.source) &&
      detailedNodeIds.has(relation.target),
  );

  return {
    nodeIndex: sourceGraph.nodes.map(compactSourceNodeIndex),
    nodes: detailedNodes.map(compactSourceNode),
    relations: detailedRelations.map(compactSourceRelation),
  };
}

/**
 * 将分数限制在 0-100。
 */
function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 压缩评分 Agent 所需的节点事实，保留状态和描述用于语义证据判断。
 */
function compactSourceNode(node: KnowledgeGraphEntity) {
  return {
    id: shortenGraphId(node.id),
    type: node.type,
    name: node.name,
    description: node.description,
    status: node.status,
  };
}

/** 压缩全图节点索引，不复制长描述。 */
function compactSourceNodeIndex(node: KnowledgeGraphEntity) {
  return {
    id: shortenGraphId(node.id),
    type: node.type,
    name: node.name,
    status: node.status,
  };
}

/**
 * 压缩评分 Agent 所需的关系事实。
 */
function compactSourceRelation(relation: KnowledgeGraphRelation) {
  return {
    id: shortenGraphId(relation.id),
    type: relation.type,
    source: shortenGraphId(relation.source),
    target: shortenGraphId(relation.target),
    description: relation.description,
  };
}

/**
 * 将图谱 UUID 形式 ID 缩短为 PRD 使用的稳定前缀。
 */
function shortenGraphId(id: string): string {
  const match = /^([A-Z]+-[0-9a-f]{8})(?:-|$)/i.exec(id);
  return match?.[1] ?? id;
}

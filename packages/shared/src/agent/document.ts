/**
 * 文档生成共享契约
 *
 * 定义 Document Agent、API 和前端共用的文档类型、运行状态、任务规划与生成结果。
 * 这些类型用于描述后台生成任务的可观察状态，不绑定具体数据库实现。
 *
 * Responsibilities:
 * - 约束 PRD/MRD/BRD 等文档工作流类型
 * - 描述 Document Agent 的 Task planning 展示结构
 * - 定义生成完成后可持久化的文档结果
 *
 * Notes:
 * - 当前仅 PRD 工作流可执行，MRD/BRD 先作为稳定枚举保留给前端禁用入口。
 */

import { z } from "zod";

/**
 * Document Agent 支持的文档工作流类型。
 */
export const DocumentKindSchema = z.enum(["prd", "mrd", "brd"]);

/**
 * 后台文档生成任务状态。
 */
export const DocumentGenerationStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "stopped",
  "failed",
]);

/**
 * Document Agent 的任务规划条目，来源于 Deep Agents write_todos。
 */
export const DocumentTodoSchema = z.object({
  index: z.number().int().nonnegative(),
  content: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed"]),
});

/**
 * 文档生成过程中持久化的思考日志。
 */
export const DocumentReasoningLogEntrySchema = z.object({
  index: z.number().int().nonnegative(),
  agentType: z.string().min(1),
  content: z.string().min(1),
  createdAt: z.string().min(1),
});

/**
 * 文档工作流阶段。
 */
export const DocumentWorkflowStageSchema = z.enum([
  "parseKg",
  "normalizeGraph",
  "buildSectionDossiers",
  "draftSection",
  "crossCheck",
  "scoreDraft",
  "aggregateScore",
  "humanReview",
  "exportPrd",
]);

/**
 * PRD 章节草稿的结构化摘要。
 */
export const DocumentSectionDraftSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  nodeIds: z.array(z.string()).default([]),
  relationIds: z.array(z.string()).default([]),
});

/**
 * 单个 PRD 评分尝试的持久化摘要。
 */
export const DocumentScoreAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  markdown: z.string().min(1),
  reviewerScores: z.array(
    z.object({
      reviewerId: z.string().min(1),
      reviewerName: z.string().min(1),
      score: z.number().min(0).max(100),
      dimensions: z.object({
        relevance: z.number().min(0).max(100),
        completeness: z.number().min(0).max(100),
        structure: z.number().min(0).max(100),
        feasibility: z.number().min(0).max(100),
        language: z.number().min(0).max(100),
      }),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
      revisionAdvice: z.array(z.string()),
      evidenceBlocked: z.boolean().default(false),
      evidenceBlockers: z.array(z.string()).default([]),
    }),
  ),
  scoreSpread: z.number().min(0).max(100),
  varianceAccepted: z.boolean(),
  aggregate: z.object({
    score: z.number().min(0).max(100),
    passed: z.boolean(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
    requiredRevisions: z.array(z.string()),
    weights: z.object({
      averageScore: z.number().min(0).max(100),
      minimumScore: z.number().min(0).max(100),
      spreadPenalty: z.number().min(0),
      consistencyBonus: z.number().min(0),
    }),
  }),
  passed: z.boolean(),
  evidenceBlocked: z.boolean().default(false),
  evidenceBlockers: z.array(z.string()).default([]),
  selected: z.boolean().default(false),
});

/**
 * 文档生成完成后的持久化结果。
 */
export const DocumentGenerationResultSchema = z.object({
  kind: DocumentKindSchema,
  title: z.string().min(1),
  markdown: z.string().min(1),
  sections: z.array(DocumentSectionDraftSchema),
  sourceGraphStats: z.object({
    nodeCount: z.number().int().nonnegative(),
    relationCount: z.number().int().nonnegative(),
  }),
  crossCheck: z.object({
    passed: z.boolean(),
    notes: z.array(z.string()),
  }),
  qualityScore: z.object({
    threshold: z.number().min(0).max(100),
    maxAllowedScoreSpread: z.number().min(0).max(100),
    maxAttempts: z.number().int().positive(),
    selectedAttempt: z.number().int().positive(),
    finalScore: z.number().min(0).max(100),
    passed: z.boolean(),
    selectionReason: z.string(),
    attempts: z.array(DocumentScoreAttemptSchema),
  }),
});

export type DocumentKind = z.infer<typeof DocumentKindSchema>;
export type DocumentGenerationStatus = z.infer<
  typeof DocumentGenerationStatusSchema
>;
export type DocumentTodo = z.infer<typeof DocumentTodoSchema>;
export type DocumentReasoningLogEntry = z.infer<
  typeof DocumentReasoningLogEntrySchema
>;
export type DocumentWorkflowStage = z.infer<typeof DocumentWorkflowStageSchema>;
export type DocumentSectionDraft = z.infer<typeof DocumentSectionDraftSchema>;
export type DocumentScoreAttempt = z.infer<typeof DocumentScoreAttemptSchema>;
export type DocumentGenerationResult = z.infer<
  typeof DocumentGenerationResultSchema
>;

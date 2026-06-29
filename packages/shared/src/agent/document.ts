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
 * 文档工作流阶段。
 */
export const DocumentWorkflowStageSchema = z.enum([
  "parseKg",
  "normalizeGraph",
  "buildSectionDossiers",
  "draftSection",
  "crossCheck",
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
});

export type DocumentKind = z.infer<typeof DocumentKindSchema>;
export type DocumentGenerationStatus = z.infer<
  typeof DocumentGenerationStatusSchema
>;
export type DocumentTodo = z.infer<typeof DocumentTodoSchema>;
export type DocumentWorkflowStage = z.infer<typeof DocumentWorkflowStageSchema>;
export type DocumentSectionDraft = z.infer<typeof DocumentSectionDraftSchema>;
export type DocumentGenerationResult = z.infer<
  typeof DocumentGenerationResultSchema
>;

/**
 * 文档生成请求 Schema
 *
 * 定义文档后台生成接口的请求体验证规则，确保 API 层只接受当前支持的文档类型
 * 和合法的运行 ID。
 *
 * Responsibilities:
 * - 校验启动文档生成任务的 document kind
 * - 校验手动中断任务所需的 runId
 * - 导出控制器复用的请求体类型
 */

import { z } from "zod";
import { DocumentKindSchema } from "@repo/shared";

/**
 * 启动文档生成任务的请求体。
 */
export const StartDocumentGenerationRequestSchema = z.object({
  kind: DocumentKindSchema,
  profileId: z.string().trim().min(1),
});

/**
 * 停止文档生成任务的请求体。
 */
export const StopDocumentGenerationRequestSchema = z.object({
  runId: z.string().uuid(),
});

/**
 * 恢复等待补充信息的文档任务请求体。
 */
export const ResumeDocumentGenerationRequestSchema = z.object({
  profileId: z.string().trim().min(1),
});

export type StartDocumentGenerationRequest = z.infer<
  typeof StartDocumentGenerationRequestSchema
>;
export type StopDocumentGenerationRequest = z.infer<
  typeof StopDocumentGenerationRequestSchema
>;
export type ResumeDocumentGenerationRequest = z.infer<
  typeof ResumeDocumentGenerationRequestSchema
>;

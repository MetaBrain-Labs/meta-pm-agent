/**
 * 提示词配置 API Schema
 *
 * 校验工作区提示词配置接口的路径参数与请求体。内容长度、必填标记等业务规则由
 * 共享的 validatePromptContent 统一判定，此处只负责形状校验。
 *
 * Responsibilities:
 * - 校验工作区 id 与 prompt id 路径参数
 * - 校验保存提示词的请求体形状
 */

import { z } from "zod";
import { MAX_PROMPT_CONTENT_LENGTH } from "@repo/shared";

export const WorkspacePromptParamsSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const PromptIdParamsSchema = z.object({
  promptId: z.string().trim().min(1).max(64),
});

/** 保存提示词请求体；空内容与超长内容由内容校验返回可读的中文提示。 */
export const SavePromptOverrideRequestSchema = z.object({
  content: z.string().max(MAX_PROMPT_CONTENT_LENGTH * 4),
});

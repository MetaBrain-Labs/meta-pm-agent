/**
 * 模型使用列表 API Schema
 *
 * 校验模型列表的新建、更新以及会话选择请求，完整模型参数复用共享契约。
 *
 * Responsibilities:
 * - 校验列表名称与配置
 * - 校验会话模型列表选择
 */

import { z } from "zod";
import { ModelUsageProfileConfigSchema } from "@repo/shared";

export const SaveModelProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  config: ModelUsageProfileConfigSchema,
});

export const SelectModelProfileRequestSchema = z.object({
  profileId: z.string().min(1),
});

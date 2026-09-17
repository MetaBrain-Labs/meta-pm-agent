/**
 * 模型使用列表 API Schema
 *
 * 校验模型列表的新建、更新以及会话 / 默认列表选择请求，完整模型参数复用共享契约。
 *
 * Responsibilities:
 * - 校验列表名称与配置
 * - 校验会话与默认模型列表选择
 */

import { z } from "zod";
import {
  ModelUsageProfileConfigSchema,
  SYSTEM_MODEL_PROFILE_ID,
} from "@repo/shared";

export const SaveModelProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  config: ModelUsageProfileConfigSchema,
});

/**
 * 列表选择请求体。
 *
 * 只接受内置默认 id 或列表 UUID：形状校验在控制器内完成，非法 id 不会触发数据库访问。
 */
export const SelectModelProfileRequestSchema = z.object({
  profileId: z.union([z.literal(SYSTEM_MODEL_PROFILE_ID), z.string().uuid()]),
});

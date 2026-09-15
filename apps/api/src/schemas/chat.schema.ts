/**
 * 会话管理请求契约
 *
 * 校验会话创建、列表查询和手动重命名请求。
 *
 * Responsibilities:
 * - 约束工作区 ID 和会话标题
 * - 为控制器提供稳定的输入类型
 *
 * Notes:
 * - 会话所有权和 active 状态由服务及仓库校验。
 */

import { z } from "zod";

/**
 * 在工作区中创建新会话的请求体校验规则。
 */
export const CreateChatRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
});

/**
 * 按工作区查询会话列表的查询参数校验规则。
 */
export const ListChatsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

/** 手动更新会话标题的请求体校验规则。 */
export const UpdateChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

/**
 * 创建会话请求体的类型。
 */
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;
/**
 * 查询会话列表参数的类型。
 */
export type ListChatsQuery = z.infer<typeof ListChatsQuerySchema>;

/** 更新会话请求体类型。 */
export type UpdateChatRequest = z.infer<typeof UpdateChatRequestSchema>;

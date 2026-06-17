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

/**
 * 创建会话请求体的类型。
 */
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;
/**
 * 查询会话列表参数的类型。
 */
export type ListChatsQuery = z.infer<typeof ListChatsQuerySchema>;

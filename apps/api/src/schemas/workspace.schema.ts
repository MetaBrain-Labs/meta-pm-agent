import { z } from "zod";

/**
 * 创建新工作区的请求体校验规则。
 */
export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  localPath: z.string().trim().min(1).max(2048).optional(),
});

/**
 * 创建工作区请求体的类型。
 */
export type CreateWorkspaceRequest = z.infer<
  typeof CreateWorkspaceRequestSchema
>;

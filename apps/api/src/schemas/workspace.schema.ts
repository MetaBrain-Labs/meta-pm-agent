/**
 * 本地工作区请求契约
 *
 * 校验工作区创建与局部更新请求的字段边界。
 *
 * Responsibilities:
 * - 约束项目名称和本地路径长度
 * - 拒绝不包含任何修改字段的 PATCH 请求
 *
 * Notes:
 * - 路径是否绝对、存在和可读由工作区服务校验。
 */

import { z } from "zod";

/** 创建本地工作区的请求体校验规则。 */
export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  localPath: z.string().trim().min(1).max(2048),
});

/** 更新本地工作区名称或路径的请求体校验规则。 */
export const UpdateWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    localPath: z.string().trim().min(1).max(2048).optional(),
  })
  .refine((value) => value.name !== undefined || value.localPath !== undefined, {
    message: "name or localPath is required.",
  });

/**
 * 创建工作区请求体的类型。
 */
export type CreateWorkspaceRequest = z.infer<
  typeof CreateWorkspaceRequestSchema
>;

/** 更新工作区请求体类型。 */
export type UpdateWorkspaceRequest = z.infer<
  typeof UpdateWorkspaceRequestSchema
>;

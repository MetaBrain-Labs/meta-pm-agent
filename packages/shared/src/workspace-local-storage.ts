/**
 * 工作区本地存储契约
 *
 * Responsibilities:
 * - 统一上下文与 PRD 的保存位置和同步状态
 *
 * Notes:
 * - 本地文件是数据库数据的项目目录副本。
 */
import { z } from "zod";

/** 单类产物的磁盘同步状态，提示仅包含可展示的阻碍与下一步。 */
export const LocalStorageEntrySchema = z.object({
  path: z.string().nullable(),
  status: z.enum(["empty", "synced", "missing", "conflict", "unavailable"]),
  message: z.string().optional(),
});

/** 工作区本地存储查询和重新同步共用的返回契约。 */
export const WorkspaceLocalStorageStatusSchema = z.object({
  workspaceId: z.string(),
  context: LocalStorageEntrySchema,
  prd: LocalStorageEntrySchema,
  warnings: z.array(z.string()),
});

/** 单类产物的保存状态。 */
export type LocalStorageEntry = z.infer<typeof LocalStorageEntrySchema>;
/** 工作区上下文与最新 PRD 的保存状态。 */
export type WorkspaceLocalStorageStatus = z.infer<typeof WorkspaceLocalStorageStatusSchema>;

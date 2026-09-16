/**
 * 工作区本地存储 API 客户端
 *
 * Responsibilities:
 * - 查询和重新同步上下文与最新 PRD 的本地副本
 *
 * Notes:
 * - 浏览器不直接访问磁盘，所有路径由 API 解析。
 */
import { WorkspaceLocalStorageStatusSchema, type WorkspaceLocalStorageStatus } from "@repo/shared";

/** 查询或重新同步工作区的本地生成文件。 */
async function requestLocalStorage(workspaceId: string, sync: boolean): Promise<WorkspaceLocalStorageStatus> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/local-storage${sync ? "/sync" : ""}`, { method: sync ? "POST" : "GET" });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "本地同步状态暂不可用。");
  return WorkspaceLocalStorageStatusSchema.parse(data);
}

/** 查询数据库数据与当前本地副本是否一致。 */
export function fetchWorkspaceLocalStorage(workspaceId: string): Promise<WorkspaceLocalStorageStatus> {
  return requestLocalStorage(workspaceId, false);
}

/** 补导出当前上下文和最新 PRD，不覆盖不同内容。 */
export function synchronizeWorkspaceLocalStorage(workspaceId: string): Promise<WorkspaceLocalStorageStatus> {
  return requestLocalStorage(workspaceId, true);
}

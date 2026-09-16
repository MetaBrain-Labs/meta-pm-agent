/**
 * 本地工作区业务服务
 *
 * 在持久化之前校验本地目录、所有权与后台运行状态，并保证移除操作只影响应用可见性。
 *
 * Responsibilities:
 * - 规范化并验证 API 主机可读取的绝对目录
 * - 管理工作区创建、更新和软删除
 * - 阻止运行中工作流对应的路径变更或移除
 *
 * Notes:
 * - 仅复制应用生成的产物，保留用户资料与原目录，不移动或递归删除文件。
 */
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  createLocalUserWorkspace,
  findActiveLocalUserWorkspaceByPath,
  getActiveLocalUserWorkspace,
  listLocalUserWorkspaces,
  softDeleteActiveLocalUserWorkspace,
  updateActiveLocalUserWorkspace,
} from "../repositories/workspace-repository";
import { listActiveConversations } from "../repositories/chat-repository";
import { getActiveDocumentGenerationRun } from "../repositories/document-generation-repository";
import { isChatRunActive } from "./chat-run-registry";
import { copyWorkspaceLocalResources, synchronizeWorkspaceLocalStorage } from "./workspace-local-storage-service";

/** 可映射为 HTTP 状态码的工作区业务错误。 */
export class WorkspaceServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/**
 * 获取当前本地用户的所有工作区列表。
 */
export function listWorkspaces() {
  return listLocalUserWorkspaces();
}

/**
 * 创建新工作区，可指定名称和本地路径。
 */
export async function createWorkspace(name: string, localPath: string) {
  const normalizedPath = await normalizeReadableDirectory(localPath);
  await assertPathAvailable(normalizedPath);
  return createLocalUserWorkspace(name, normalizedPath);
}

/** 更新工作区名称或关联的本地目录。 */
export async function updateWorkspace(
  workspaceId: string,
  input: { name?: string; localPath?: string },
) {
  const existing = await requireActiveWorkspace(workspaceId);
  let nextPath = existing.localPath;
  if (!nextPath) {
    throw new WorkspaceServiceError("工作区缺少本地目录。", 400);
  }

  if (input.localPath !== undefined) {
    await assertWorkspaceHasNoActiveRuns(workspaceId, "修改项目路径");
    nextPath = await normalizeReadableDirectory(input.localPath);
    await assertPathAvailable(nextPath, workspaceId);
  }

  const updated = await updateActiveLocalUserWorkspace(workspaceId, {
    name: input.name ?? existing.name,
    localPath: nextPath,
  });
  if (!updated) {
    throw new WorkspaceServiceError("项目不存在或已被移除。", 404);
  }
  if (input.localPath !== undefined && existing.localPath !== nextPath) {
    // 关联路径先落库；磁盘复制失败只影响同步提示，不能撤销已保存的项目设置。
    const warnings = await copyWorkspaceLocalResources(workspaceId, existing.localPath!, nextPath);
    try {
      const status = await synchronizeWorkspaceLocalStorage(updated);
      warnings.push(...status.warnings);
    } catch {
      warnings.push("路径已更新，暂时无法补导出数据库产物，请稍后重新同步。");
    }
    return { ...updated, localStorageWarnings: [...new Set(warnings)] };
  }
  return updated;
}

/** 软删除工作区，保留数据库内容和本地目录。 */
export async function removeWorkspace(workspaceId: string): Promise<void> {
  await requireActiveWorkspace(workspaceId);
  await assertWorkspaceHasNoActiveRuns(workspaceId, "移除项目");
  if (!(await softDeleteActiveLocalUserWorkspace(workspaceId))) {
    throw new WorkspaceServiceError("项目不存在或已被移除。", 404);
  }
}

/** 确认工作区属于本地用户且仍处于 active 状态。 */
export async function requireActiveWorkspace(workspaceId: string) {
  const workspace = await getActiveLocalUserWorkspace(workspaceId);
  if (!workspace) {
    throw new WorkspaceServiceError("项目不存在或已被移除。", 404);
  }
  return workspace;
}

/** 将用户输入规范化为当前 API 主机上的可读绝对目录。 */
async function normalizeReadableDirectory(value: string): Promise<string> {
  if (!path.isAbsolute(value)) {
    throw new WorkspaceServiceError(
      "请输入 API 所在机器上的绝对项目路径。",
      400,
    );
  }

  const resolved = path.resolve(value);
  try {
    const normalized = path.normalize(await realpath(resolved));
    const info = await stat(normalized);
    if (!info.isDirectory()) {
      throw new WorkspaceServiceError("项目路径必须指向一个文件夹。", 400);
    }
    await access(normalized, constants.R_OK);
    return normalized;
  } catch (error) {
    if (error instanceof WorkspaceServiceError) throw error;
    throw new WorkspaceServiceError("项目路径不存在或不可读取。", 400);
  }
}

/** 防止同一本地目录被重复添加到 active 项目列表。 */
async function assertPathAvailable(
  localPath: string,
  excludedId?: string,
): Promise<void> {
  const duplicate = await findActiveLocalUserWorkspaceByPath(
    localPath,
    excludedId,
  );
  if (duplicate) {
    throw new WorkspaceServiceError("该本地目录已经添加为项目。", 409);
  }
}

/** 路径变更或项目移除前拒绝仍在执行的聊天与 PRD。 */
export async function assertWorkspaceHasNoActiveRuns(
  workspaceId: string,
  action: string,
): Promise<void> {
  const [conversations, documentRun] = await Promise.all([
    listActiveConversations(workspaceId),
    getActiveDocumentGenerationRun(workspaceId, "prd"),
  ]);
  if (
    documentRun ||
    conversations.some((conversation) => isChatRunActive(conversation.id))
  ) {
    throw new WorkspaceServiceError(
      `当前项目仍有运行中的任务，停止后才能${action}。`,
      409,
    );
  }
}

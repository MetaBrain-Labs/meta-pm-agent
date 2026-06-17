import {
  createLocalUserWorkspace,
  getLocalUserAccount,
  listLocalUserWorkspaces,
} from "../repositories/workspace-repository";

/**
 * 获取当前本地用户的账户信息。
 */
export function getAccount() {
  return getLocalUserAccount();
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
export function createWorkspace(name?: string, localPath?: string) {
  return createLocalUserWorkspace(name, localPath);
}

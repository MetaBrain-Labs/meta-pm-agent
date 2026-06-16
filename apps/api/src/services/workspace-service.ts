import {
  createLocalUserWorkspace,
  getLocalUserAccount,
  listLocalUserWorkspaces,
} from "../repositories/workspace-repository";

export function getAccount() {
  return getLocalUserAccount();
}

export function listWorkspaces() {
  return listLocalUserWorkspaces();
}

export function createWorkspace(name?: string, localPath?: string) {
  return createLocalUserWorkspace(name, localPath);
}

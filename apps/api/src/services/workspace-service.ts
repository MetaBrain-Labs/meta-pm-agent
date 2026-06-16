import {
  createLocalUserWorkspace,
  listLocalUserWorkspaces,
} from "../repositories/workspace-repository";

export function listWorkspaces() {
  return listLocalUserWorkspaces();
}

export function createWorkspace(name?: string) {
  return createLocalUserWorkspace(name);
}

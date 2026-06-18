import type {
  AccountInfo,
  Message,
  PersistedMessageInfo,
  ThreadInfo,
  WorkspaceInfo,
} from "../types";
import { mapPersistedMessageToMessage } from "../mappers/persisted-message";

/**
 * 获取当前默认账号信息。
 */
export async function fetchAccount(): Promise<AccountInfo> {
  const response = await fetch("/api/account");

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    account: AccountInfo;
  };

  return data.account;
}

/**
 * 获取账号下可用的工作区列表。
 */
export async function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
  const response = await fetch("/api/workspaces");

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    workspaces: WorkspaceInfo[];
  };

  return data.workspaces;
}

/**
 * 创建工作区记录，并保留用户选择的本地路径。
 */
export async function createWorkspaceRecord(
  name: string,
  localPath: string,
): Promise<WorkspaceInfo> {
  const response = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, localPath }),
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    workspace: WorkspaceInfo;
  };

  return data.workspace;
}

/**
 * 创建会话及其对应的需求表单上下文。
 */
export async function createChatRecord(
  workspaceId: string,
  title: string,
): Promise<ThreadInfo> {
  const response = await fetch("/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, title }),
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    chat: ThreadInfo;
    requestForm: {
      id: string;
    };
  };

  return {
    ...data.chat,
    requestFormId: data.requestForm.id,
  };
}

/**
 * 获取指定工作区下的会话列表。
 */
export async function fetchChatRecords(
  workspaceId: string,
): Promise<ThreadInfo[]> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(`/api/chats?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    chats: ThreadInfo[];
  };

  return data.chats;
}

/**
 * 获取指定会话的历史消息，并恢复成聊天界面消息模型。
 */
export async function fetchChatMessages(threadId: string): Promise<Message[]> {
  const response = await fetch(`/api/chats/${threadId}/messages`);

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    messages: PersistedMessageInfo[];
  };

  return data.messages.map(mapPersistedMessageToMessage);
}

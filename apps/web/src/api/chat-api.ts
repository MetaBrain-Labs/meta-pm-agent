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
    messageCount: data.chat.messageCount ?? 0,
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

/**
 * 请求服务端停止指定会话当前运行中的 Agent。
 */
export async function stopChatGeneration(threadId: string): Promise<void> {
  await fetch("/api/chat/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: threadId }),
    keepalive: true,
  });
}

/**
 * 产品知识图谱查询结果。
 */
export interface WorkspaceKnowledgeGraphData {
  /** nodes 和 relations 都有数据时为 true，按钮可用 */
  hasData: boolean;
  /** 按参考格式生成的 markdown 文本 */
  markdown: string;
  version: number;
  updatedAt: string;
}

/**
 * 获取指定工作区的产品知识图谱数据。
 * 返回 hasData 供前端判断按钮是否可用，以及生成的 markdown 供下载。
 */
export async function fetchProductKnowledgeGraph(
  workspaceId: string,
): Promise<WorkspaceKnowledgeGraphData> {
  const response = await fetch(
    `/api/workspaces/${workspaceId}/knowledge-graph`,
  );

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as WorkspaceKnowledgeGraphData;
  return data;
}

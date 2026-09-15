/**
 * 聊天与工作区 API 客户端
 *
 * 封装浏览器侧访问本地工作区、聊天历史、知识图谱和文档生成状态的 HTTP 请求，
 * 并定义这些接口返回给 React 视图层的 DTO 类型。
 *
 * Responsibilities:
 * - 提供 chat/workspace/document/knowledge-graph 相关 fetch 方法
 * - 定义前端消费的持久化消息和知识图谱数据类型
 * - 将 API 错误转换为可读异常
 *
 * Notes:
 * - 不负责 SSE 流式 reducer，流式事件处理位于 utils/apply-stream-event。
 */

import type {
  Message,
  PersistedMessageInfo,
  ThreadInfo,
  WorkspaceInfo,
  ModelUsageProfile,
} from "../types";
import { mapPersistedMessageToMessage } from "../mappers/persisted-message";

/** 获取本地可用模型列表，首项始终为内置默认列表。 */
export async function fetchModelProfiles(): Promise<ModelUsageProfile[]> {
  const response = await fetch("/api/model-profiles");
  if (!response.ok) throw new Error(`Server error: ${response.status}`);
  return ((await response.json()) as { profiles: ModelUsageProfile[] }).profiles;
}

/** 新建本地模型使用列表。 */
export async function createModelProfile(
  input: Pick<ModelUsageProfile, "name" | "config">,
): Promise<ModelUsageProfile> {
  return saveModelProfile("/api/model-profiles", "POST", input);
}

/** 更新本地模型使用列表。 */
export async function updateModelProfile(
  id: string,
  input: Pick<ModelUsageProfile, "name" | "config">,
): Promise<ModelUsageProfile> {
  return saveModelProfile(`/api/model-profiles/${id}`, "PUT", input);
}

/** 删除本地模型使用列表，关联会话由数据库级联自动回退默认。 */
export async function deleteModelProfile(id: string): Promise<void> {
  const response = await fetch(`/api/model-profiles/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Server error: ${response.status}`);
}

/** 获取会话当前模型使用列表。 */
export async function fetchChatModelProfile(
  chatId: string,
): Promise<ModelUsageProfile> {
  const response = await fetch(`/api/chats/${chatId}/model-profile`);
  if (!response.ok) throw new Error(`Server error: ${response.status}`);
  return ((await response.json()) as { profile: ModelUsageProfile }).profile;
}

/** 空闲或 HITL 状态下更新会话模型列表。 */
export async function selectChatModelProfile(
  chatId: string,
  profileId: string,
): Promise<ModelUsageProfile> {
  const response = await fetch(`/api/chats/${chatId}/model-profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId }),
  });
  if (!response.ok) throw new Error(`Server error: ${response.status}`);
  return ((await response.json()) as { profile: ModelUsageProfile }).profile;
}

/** 统一提交模型列表并保留服务端冲突状态。 */
async function saveModelProfile(
  url: string,
  method: "POST" | "PUT",
  input: Pick<ModelUsageProfile, "name" | "config">,
): Promise<ModelUsageProfile> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Server error: ${response.status}`);
  return ((await response.json()) as { profile: ModelUsageProfile }).profile;
}

/**
 * 获取当前本地用户可用的工作区列表。
 */
export async function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
  const response = await fetch("/api/workspaces");

  await assertApiResponse(response);

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

  await assertApiResponse(response);

  const data = (await response.json()) as {
    workspace: WorkspaceInfo;
  };

  return data.workspace;
}

/** 更新本地工作区名称或路径。 */
export async function updateWorkspaceRecord(
  id: string,
  input: { name?: string; localPath?: string },
): Promise<WorkspaceInfo> {
  const response = await fetch(`/api/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await assertApiResponse(response);
  return ((await response.json()) as { workspace: WorkspaceInfo }).workspace;
}

/** 从列表软删除工作区，不触碰磁盘目录。 */
export async function deleteWorkspaceRecord(id: string): Promise<void> {
  const response = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
  await assertApiResponse(response);
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

  await assertApiResponse(response);

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

/** 手动重命名会话。 */
export async function updateChatRecord(
  id: string,
  title: string,
): Promise<ThreadInfo> {
  const response = await fetch(`/api/chats/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  await assertApiResponse(response);
  return ((await response.json()) as { chat: ThreadInfo }).chat;
}

/** 软删除会话并保留历史数据。 */
export async function deleteChatRecord(id: string): Promise<void> {
  const response = await fetch(`/api/chats/${id}`, { method: "DELETE" });
  await assertApiResponse(response);
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
export async function stopChatGeneration(
  threadId: string,
  origin: "manual_stop" | "page_unload" = "manual_stop",
): Promise<void> {
  await fetch("/api/chat/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: threadId, origin }),
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
  /** 结构化节点数据 */
  nodes: KnowledgeGraphNodeData[];
  /** 结构化关系数据 */
  relations: KnowledgeGraphRelationData[];
  version: number;
  updatedAt: string;
}

/**
 * 知识图谱节点数据（前端视图）。
 */
export interface KnowledgeGraphNodeData {
  id: string;
  type:
    | "Goal"
    | "Requirement"
    | "Evidence"
    | "Decision"
    | "Feature"
    | "Component"
    | "Metric"
    | "Risk"
    | "OpenQuestion"
    | "Custom";
  name: string;
  description?: string;
  source_task_id?: string;
  status?: "proposed" | "confirmed" | "deprecated";
}

/**
 * 知识图谱关系数据（前端视图）。
 */
export interface KnowledgeGraphRelationData {
  id: string;
  type: "Drives" | "Satisfies" | "Promotes" | "Produces" | "Constrains" | "Implements" | "Measures" | "Validates" | "References" | "Composes" | "Custom";
  source: string;
  target: string;
  description?: string;
  source_task_id?: string;
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

/** 将 API JSON 错误正文转为可直接展示的异常。 */
async function assertApiResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  if (typeof body?.error === "string") throw new Error(body.error);
  throw new Error(`Server error: ${response.status}`);
}

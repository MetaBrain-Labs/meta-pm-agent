/**
 * 提示词配置 API 客户端
 *
 * 封装设置页「提示词管理」需要的读取、保存与恢复默认请求，并把服务端的中文业务
 * 错误转换为可直接展示的异常。
 *
 * Responsibilities:
 * - 查询当前身份的提示词配置能力
 * - 读取工作区提示词列表（含默认 / 已自定义状态）
 * - 保存自定义提示词与恢复内置默认
 *
 * Notes:
 * - 权限始终由服务端判定，客户端只根据能力隐藏按钮，不做本地放行
 */

import type { PromptConfigAccess, PromptSummary } from "../types";

/** 读取当前身份可执行的提示词配置动作，用于决定设置导航是否显示该页。 */
export async function fetchPromptConfigAccess(): Promise<PromptConfigAccess> {
  const response = await fetch("/api/prompt-config/access");
  await assertApiResponse(response);
  return ((await response.json()) as { access: PromptConfigAccess }).access;
}

/** 读取工作区提示词列表与当前能力。 */
export async function fetchWorkspacePrompts(workspaceId: string): Promise<{
  prompts: PromptSummary[];
  access: PromptConfigAccess;
}> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/prompts`,
  );
  await assertApiResponse(response);
  return (await response.json()) as {
    prompts: PromptSummary[];
    access: PromptConfigAccess;
  };
}

/** 保存单条提示词的自定义内容。 */
export async function saveWorkspacePrompt(
  workspaceId: string,
  promptId: string,
  content: string,
): Promise<PromptSummary> {
  const response = await fetch(buildPromptUrl(workspaceId, promptId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  await assertApiResponse(response);
  return ((await response.json()) as { prompt: PromptSummary }).prompt;
}

/** 删除单条提示词的自定义内容，使运行时回退内置默认（幂等）。 */
export async function resetWorkspacePrompt(
  workspaceId: string,
  promptId: string,
): Promise<PromptSummary> {
  const response = await fetch(buildPromptUrl(workspaceId, promptId), {
    method: "DELETE",
  });
  await assertApiResponse(response);
  return ((await response.json()) as { prompt: PromptSummary }).prompt;
}

function buildPromptUrl(workspaceId: string, promptId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/prompts/${encodeURIComponent(promptId)}`;
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

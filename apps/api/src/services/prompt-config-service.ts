/**
 * 工作区提示词配置服务
 *
 * 把 Prompt Registry、内容校验和 override 持久化编排成设置页可用的用例：
 * 列表展示（默认 / 已自定义）、保存自定义内容、恢复内置默认。
 *
 * Responsibilities:
 * - listWorkspacePrompts()：返回白名单提示词的 default/override/effective 状态
 * - saveWorkspacePrompt()：校验注册表、可编辑性、内容规则后写入 override
 * - resetWorkspacePrompt()：幂等删除 override，使运行时自然回退内置默认
 *
 * Notes:
 * - 只有 Prompt Registry 中显式注册的提示词才可能被读写，内部提示词一律 404
 * - 恢复默认绝不把内置正文复制成 override，避免应用升级后旧默认被固化
 */

import {
  createPromptSummary,
  createPromptSummaries,
  getPromptCatalogEntry,
  type PromptCatalogEntryShape,
} from "@repo/agent-runtime";
import { validatePromptContent, type PromptSummary, type PromptOverrides } from "@repo/shared";
import {
  deleteWorkspacePromptOverride,
  listWorkspacePromptOverrides,
  saveWorkspacePromptOverride,
  type PromptOverrideRecord,
} from "../repositories/prompt-override-repository";
import { requireActiveWorkspace } from "./workspace-service";

/** 可映射为 HTTP 状态码的提示词配置业务错误。 */
export class PromptConfigError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404,
  ) {
    super(message);
  }
}

/**
 * 把持久化记录压缩为 override 快照。
 *
 * 列表与「保存后立即返回状态」共用本函数，避免保存成功却回显默认状态这类不一致。
 */
export function createOverrideSnapshot(
  records: readonly PromptOverrideRecord[],
): PromptOverrides {
  return Object.fromEntries(
    records.map((record) => [record.promptId, record.content]),
  );
}

/**
 * 校验 prompt id 来自 Prompt Registry，并按需校验可编辑 / 可恢复。
 *
 * promptId 只用于注册表查表，不会被当作文件路径或任意数据库键使用。
 */
export function requireRegisteredPrompt(
  promptId: string,
  options: { editable?: boolean; resettable?: boolean } = {},
): PromptCatalogEntryShape {
  const entry = getPromptCatalogEntry(promptId);
  if (!entry) {
    throw new PromptConfigError("提示词不存在或不可配置。", 404);
  }
  if (options.editable && !entry.editable) {
    throw new PromptConfigError("该提示词不支持自定义。", 403);
  }
  if (options.resettable && !entry.resettable) {
    throw new PromptConfigError("该提示词不支持恢复默认。", 403);
  }
  return entry;
}

/**
 * 返回当前工作区的提示词状态列表。
 *
 * 自定义内容即使已落库，只要未通过内容校验就不会被运行时采用，这里同步给出
 * storedOverrideIgnored 标记，避免界面显示「已自定义」而实际仍在使用内置默认。
 */
export async function listWorkspacePrompts(
  workspaceId: string,
): Promise<PromptSummary[]> {
  await requireActiveWorkspace(workspaceId);
  const records = await listWorkspacePromptOverrides(workspaceId);
  const updatedAtByPromptId: Record<string, string | null> = {};
  for (const record of records) {
    updatedAtByPromptId[record.promptId] = record.updatedAt;
  }
  return createPromptSummaries(createOverrideSnapshot(records), updatedAtByPromptId);
}

/**
 * 保存工作区自定义提示词，返回保存后的最新状态。
 */
export async function saveWorkspacePrompt(input: {
  workspaceId: string;
  promptId: string;
  content: string;
}): Promise<PromptSummary> {
  const entry = requireRegisteredPrompt(input.promptId, { editable: true });

  const validation = validatePromptContent(input.content, {
    requiredTokens: entry.requiredTokens,
  });
  if (!validation.ok) {
    throw new PromptConfigError(validation.message, 400);
  }

  await requireActiveWorkspace(input.workspaceId);
  const saved = await saveWorkspacePromptOverride({
    workspaceId: input.workspaceId,
    promptId: entry.id,
    content: input.content,
  });

  // 保存后立即返回「已自定义」状态，避免界面回显默认内容。
  return createPromptSummary(
    entry.id,
    createOverrideSnapshot([saved]),
    saved.updatedAt,
  );
}

/**
 * 恢复内置默认：删除 override，使运行时回退到程序内置正文。
 *
 * 该操作幂等：override 不存在时同样返回默认状态，不产生错误也不写入默认副本。
 */
export async function resetWorkspacePrompt(input: {
  workspaceId: string;
  promptId: string;
}): Promise<PromptSummary> {
  const entry = requireRegisteredPrompt(input.promptId, { resettable: true });
  await requireActiveWorkspace(input.workspaceId);
  await deleteWorkspacePromptOverride({
    workspaceId: input.workspaceId,
    promptId: entry.id,
  });
  return createPromptSummary(entry.id, {});
}

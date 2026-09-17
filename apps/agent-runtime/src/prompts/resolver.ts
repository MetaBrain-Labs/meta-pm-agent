/**
 * 提示词解析器（Prompt Resolver）
 *
 * 统一实现 default → workspace override → effective 的解析规则，供所有被注册为
 * configurable 的 Agent 复用。任何 Agent 都不得自行实现 override 逻辑。
 *
 * Responsibilities:
 * - resolvePrompt()：解析单条提示词当前生效正文，并标明是否采用自定义内容
 * - sanitizePromptOverrides()：把外部传入的 override 快照收敛到已注册 id 且内容合法
 * - createPromptSummary()/createPromptSummaries()：为设置页生成 default/override/effective 状态视图
 * - getPromptOverridesFromRunnableConfig()：从 LangGraph run config 恢复本轮快照
 *
 * Notes:
 * - 用户恢复默认时由持久化层删除 override，本模块不复制 defaultContent 落库
 * - 已持久化的 override 若未通过校验（手工改库等），运行时回退内置默认并标记忽略
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import {
  validatePromptContent,
  type PromptOverrides,
  type PromptSummary,
} from "@repo/shared";
import {
  getPromptCatalogEntry,
  isConfigurablePromptId,
  PROMPT_CATALOG,
  type PromptCatalogEntryShape,
  type PromptId,
} from "./catalog";

/** LangGraph run config 中存放本轮提示词快照的键。 */
export const PROMPT_OVERRIDES_RUN_CONFIG_KEY = "prompt_overrides";

/** 单条提示词的解析结果。 */
export interface ResolvedPrompt {
  id: PromptId;
  entry: PromptCatalogEntryShape;
  /** 真正进入模型上下文的正文。 */
  content: string;
  /** 是否采用了工作区 override。 */
  customized: boolean;
  /** 是否存在 override，但因其不合法而回退内置默认。 */
  storedOverrideIgnored: boolean;
}

/**
 * 解析单条提示词当前生效正文。
 *
 * override 只有在非空、未超长且保留全部 requiredTokens 时才会被采用，避免被破坏的
 * 自定义内容进入模型上下文并让下游解析静默失效。
 */
export function resolvePrompt(
  promptId: PromptId,
  overrides?: PromptOverrides,
): ResolvedPrompt {
  const entry = getPromptCatalogEntry(promptId);
  if (!entry) {
    throw new Error(`Prompt "${promptId}" is not registered as configurable.`);
  }

  const candidate = overrides?.[promptId];
  if (typeof candidate === "string") {
    const validation = validatePromptContent(candidate, {
      requiredTokens: entry.requiredTokens,
    });
    if (validation.ok) {
      return {
        id: promptId,
        entry,
        content: candidate,
        customized: true,
        storedOverrideIgnored: false,
      };
    }
    return {
      id: promptId,
      entry,
      content: entry.defaultContent,
      customized: false,
      storedOverrideIgnored: true,
    };
  }

  return {
    id: promptId,
    entry,
    content: entry.defaultContent,
    customized: false,
    storedOverrideIgnored: false,
  };
}

/** 解析单条提示词的生效正文，供 Agent 组装 system prompt 使用。 */
export function resolvePromptContent(
  promptId: PromptId,
  overrides?: PromptOverrides,
): string {
  return resolvePrompt(promptId, overrides).content;
}

/**
 * 收敛外部 override 快照：只保留已注册 id 且通过校验的文本。
 *
 * 该函数是运行时侧的边界，确保跨进程传入的任意对象不会引入未知 prompt id 或非法正文。
 */
export function sanitizePromptOverrides(value: unknown): PromptOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const sanitized: Record<string, string> = {};
  for (const [promptId, content] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (typeof content !== "string") continue;
    if (!isConfigurablePromptId(promptId)) continue;
    const entry = getPromptCatalogEntry(promptId);
    if (!entry) continue;
    if (
      !validatePromptContent(content, { requiredTokens: entry.requiredTokens }).ok
    ) {
      continue;
    }
    sanitized[promptId] = content;
  }

  return Object.freeze(sanitized);
}

/** 从 LangGraph run config 恢复 API 注入的本轮提示词快照。 */
export function getPromptOverridesFromRunnableConfig(
  config: RunnableConfig | undefined,
): PromptOverrides {
  return sanitizePromptOverrides(
    config?.configurable?.[PROMPT_OVERRIDES_RUN_CONFIG_KEY],
  );
}

/**
 * 生成设置页所需的单条提示词状态。
 */
export function createPromptSummary(
  promptId: PromptId,
  overrides?: PromptOverrides,
  updatedAt: string | null = null,
): PromptSummary {
  const entry = getPromptCatalogEntry(promptId);
  if (!entry) {
    throw new Error(`Prompt "${promptId}" is not registered as configurable.`);
  }
  const resolved = resolvePrompt(promptId, overrides);
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    requiredTokens: [...entry.requiredTokens],
    editable: entry.editable,
    resettable: entry.resettable,
    customized: resolved.customized,
    storedOverrideIgnored: resolved.storedOverrideIgnored,
    content: resolved.content,
    defaultContent: entry.defaultContent,
    updatedAt,
  };
}

/**
 * 生成设置页所需的提示词状态列表。
 *
 * updatedAtByPromptId 由持久化层提供，用于展示 override 的最后保存时间；没有 override
 * 的条目保持 null，体现「默认」状态。
 */
export function createPromptSummaries(
  overrides?: PromptOverrides,
  updatedAtByPromptId: Readonly<Record<string, string | null>> = {},
): PromptSummary[] {
  return PROMPT_CATALOG.map((entry) =>
    createPromptSummary(
      entry.id,
      overrides,
      updatedAtByPromptId[entry.id] ?? null,
    ),
  );
}

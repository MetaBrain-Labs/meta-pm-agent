/**
 * 提示词配置共享契约
 *
 * 定义可配置提示词的白名单元数据、内容校验规则、override 快照以及提示词配置能力
 * （prompt:read / prompt:write / prompt:reset）。API 持久化校验、Agent Runtime 运行时
 * 解析和前端 DTO 共同使用本文件，避免各处重复实现同一套规则。
 *
 * Responsibilities:
 * - 定义 PromptCatalogEntry / PromptSummary / PromptConfigAccess 等跨端契约
 * - 定义内容长度上限、必填标记（requiredTokens）校验函数
 * - 定义提示词能力矩阵（角色 → 能力）与能力判定辅助函数
 *
 * Notes:
 * - 本文件只描述契约与纯函数，不访问数据库、不读取环境变量
 * - 默认正文由 Agent Runtime 的 Prompt Registry 提供，本文件不保存任何提示词文本
 */

import { z } from "zod";

/** 提示词配置能力标识；能力来源必须是服务端可信层。 */
export const PROMPT_CAPABILITIES = [
  "prompt:read",
  "prompt:write",
  "prompt:reset",
] as const;

export const PromptCapabilitySchema = z.enum(PROMPT_CAPABILITIES);

export type PromptCapability = (typeof PROMPT_CAPABILITIES)[number];

/**
 * 提示词配置访问角色。
 *
 * owner 工作区所有者，editor 可编辑，viewer 只读，none 无任何提示词配置能力。
 */
export const PromptAccessRoleSchema = z.enum(["owner", "editor", "viewer", "none"]);

export type PromptAccessRole = z.infer<typeof PromptAccessRoleSchema>;

/**
 * 逻辑权限矩阵：角色到能力的唯一映射来源。
 */
export const PROMPT_ROLE_CAPABILITIES: Record<
  PromptAccessRole,
  readonly PromptCapability[]
> = {
  owner: ["prompt:read", "prompt:write", "prompt:reset"],
  editor: ["prompt:read", "prompt:write"],
  viewer: ["prompt:read"],
  none: [],
};

/** 判断能力集合是否包含指定能力。 */
export function hasPromptCapability(
  capabilities: readonly PromptCapability[],
  capability: PromptCapability,
): boolean {
  return capabilities.includes(capability);
}

/** 提示词分类，用于设置页分组展示。 */
export const PromptCategorySchema = z.enum(["conversation", "analysis", "document"]);

export type PromptCategory = z.infer<typeof PromptCategorySchema>;

/** 单条提示词 override 的最大字符数，防止异常内容进入模型上下文。 */
export const MAX_PROMPT_CONTENT_LENGTH = 40_000;

/** 单条提示词允许声明的必填标记数量上限。 */
export const MAX_PROMPT_REQUIRED_TOKENS = 8;

/** prompt id 形状：小写短横线标识，只允许来自 Prompt Registry。 */
export const PromptIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Prompt id must be a lowercase kebab-case identifier.",
  });

/**
 * 可配置提示词的白名单条目。
 *
 * defaultContent 是程序内置默认值，运行时不可被用户修改覆盖；requiredTokens 描述
 * 用户编辑后必须保留的字面协议标记（例如标签块或下游 JSON 字段名），因为本项目的
 * 提示词通过字符串拼接组合，不存在 `{{var}}` 模板语法。
 */
export const PromptCatalogEntrySchema = z.object({
  id: PromptIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(400),
  category: PromptCategorySchema,
  defaultContent: z.string().min(1).max(MAX_PROMPT_CONTENT_LENGTH),
  requiredTokens: z
    .array(z.string().min(1).max(64))
    .max(MAX_PROMPT_REQUIRED_TOKENS)
    .default([]),
  editable: z.boolean(),
  resettable: z.boolean(),
});

export type PromptCatalogEntry = z.infer<typeof PromptCatalogEntrySchema>;

/**
 * 设置页展示的单条提示词状态。
 *
 * content 是当前生效正文（override 优先，否则内置默认）；customized 表示数据库中
 * 是否存在该工作区的 override；storedOverrideIgnored 表示已持久化的 override 未通过
 * 校验、运行时已回退内置默认，需要提示用户重新保存或恢复默认。
 */
export interface PromptSummary {
  id: string;
  name: string;
  description: string;
  category: PromptCategory;
  requiredTokens: string[];
  editable: boolean;
  resettable: boolean;
  customized: boolean;
  storedOverrideIgnored: boolean;
  content: string;
  defaultContent: string;
  updatedAt: string | null;
}

/** 当前身份可执行的提示词配置动作；前端据此显隐，服务端独立校验。 */
export interface PromptConfigAccess {
  role: PromptAccessRole;
  canRead: boolean;
  canWrite: boolean;
  canReset: boolean;
}

/** 一次运行的提示词 override 快照：promptId → 用户自定义正文。 */
export type PromptOverrides = Readonly<Record<string, string>>;

export const PromptOverridesSchema = z.record(z.string(), z.string());

export type PromptContentValidationCode = "empty" | "too_long" | "missing_tokens";

/** 提示词正文校验结果。 */
export type PromptContentValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: PromptContentValidationCode;
      message: string;
      missingTokens: string[];
    };

/** 返回用户编辑后丢失的必填标记，保持声明顺序便于直接展示。 */
export function findMissingRequiredTokens(
  content: string,
  requiredTokens: readonly string[],
): string[] {
  return requiredTokens.filter((token) => !content.includes(token));
}

/**
 * 校验用户提交或读取到的提示词正文。
 *
 * 只判断空内容、长度与必填标记；不修剪内容本身，保存时按原样保留换行与空格。
 */
export function validatePromptContent(
  content: string,
  options: {
    requiredTokens?: readonly string[];
    maxLength?: number;
  } = {},
): PromptContentValidationResult {
  const maxLength = options.maxLength ?? MAX_PROMPT_CONTENT_LENGTH;
  if (content.trim().length === 0) {
    return {
      ok: false,
      code: "empty",
      message: "提示词内容不能为空。",
      missingTokens: [],
    };
  }
  if (content.length > maxLength) {
    return {
      ok: false,
      code: "too_long",
      message: `提示词内容过长，最多 ${maxLength} 个字符。`,
      missingTokens: [],
    };
  }

  const missingTokens = findMissingRequiredTokens(
    content,
    options.requiredTokens ?? [],
  );
  if (missingTokens.length > 0) {
    return {
      ok: false,
      code: "missing_tokens",
      message: `缺少必要变量：${missingTokens.join("、")}`,
      missingTokens,
    };
  }

  return { ok: true };
}

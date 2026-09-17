/**
 * 提示词配置权限服务
 *
 * 提供提示词配置的最小权限抽象：能力集合（prompt:read / prompt:write / prompt:reset）
 * 与可信的身份来源适配器。当前部署是单用户本地运行，因此默认身份为工作区所有者，
 * 拥有全部提示词配置能力。
 *
 * Responsibilities:
 * - resolvePromptPrincipal()：从服务端可信来源解析当前身份与能力
 * - toPromptConfigAccess()：把能力集合转换为前端可消费的只读视图
 * - requirePromptCapability()：在控制器中做真正的服务端校验
 *
 * Notes:
 * - 能力只能来自服务端环境变量或未来的登录中间件；HTTP 请求头、请求体、前端开关
 *   一律不参与判定，避免用户给自己提权
 * - 接入真实鉴权时只需替换 resolvePromptPrincipal()，控制器无需改动
 * - 未知角色按 none 处理（fail-closed），配置写错不会意外放开写权限
 */

import {
  hasPromptCapability,
  PROMPT_ROLE_CAPABILITIES,
  type PromptAccessRole,
  type PromptCapability,
  type PromptConfigAccess,
} from "@repo/shared";

/** 可信权限来源：提示词配置角色。 */
export const PROMPT_CONFIG_ACCESS_ROLE_ENV = "PROMPT_CONFIG_ACCESS_ROLE";
/** 可信权限来源：当前操作身份 id。 */
export const PROMPT_CONFIG_USER_ID_ENV = "PROMPT_CONFIG_USER_ID";
/** 本地单用户部署的固定身份，与工作区/模型列表仓库保持一致。 */
export const LOCAL_USER_ID = "local";

/** 当前操作身份及其提示词配置能力。 */
export interface PromptPrincipal {
  userId: string;
  role: PromptAccessRole;
  capabilities: readonly PromptCapability[];
}

/** 可映射为 HTTP 403 的权限错误。 */
export class PromptPermissionError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
  }
}

/**
 * 解析角色配置；未设置时视为本地所有者，未知值一律按 none 处理。
 */
export function parsePromptAccessRole(value: string | undefined): PromptAccessRole {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "owner";
  if (
    normalized === "owner" ||
    normalized === "editor" ||
    normalized === "viewer" ||
    normalized === "none"
  ) {
    return normalized;
  }
  return "none";
}

/** 依据角色构造身份，能力只能取自共享权限矩阵。 */
export function createPromptPrincipal(
  role: PromptAccessRole,
  userId: string = LOCAL_USER_ID,
): PromptPrincipal {
  return {
    userId,
    role,
    capabilities: PROMPT_ROLE_CAPABILITIES[role],
  };
}

/**
 * 解析当前请求的操作身份。
 *
 * 每次调用重新读取环境变量，便于运维与测试在同一进程内切换角色；该函数是权限
 * 接入点，未来替换为登录态解析即可。
 */
export function resolvePromptPrincipal(): PromptPrincipal {
  const role = parsePromptAccessRole(
    process.env[PROMPT_CONFIG_ACCESS_ROLE_ENV],
  );
  const userId =
    process.env[PROMPT_CONFIG_USER_ID_ENV]?.trim() || LOCAL_USER_ID;
  return createPromptPrincipal(role, userId);
}

/** 转换为前端只读视图；不泄露能力来源细节。 */
export function toPromptConfigAccess(
  principal: PromptPrincipal,
): PromptConfigAccess {
  return {
    role: principal.role,
    canRead: hasPromptCapability(principal.capabilities, "prompt:read"),
    canWrite: hasPromptCapability(principal.capabilities, "prompt:write"),
    canReset: hasPromptCapability(principal.capabilities, "prompt:reset"),
  };
}

/**
 * 要求当前身份具备指定能力，否则抛出 403。
 *
 * 该检查必须发生在任何数据库访问之前，保证「无权限」不会被资源存在性探测绕过。
 */
export function requirePromptCapability(
  principal: PromptPrincipal,
  capability: PromptCapability,
  action: string,
): void {
  if (hasPromptCapability(principal.capabilities, capability)) return;
  throw new PromptPermissionError(`当前身份没有${action}的权限。`);
}

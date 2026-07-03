/**
 * Token 用量格式化与聚合工具
 *
 * 提供 Token 数量、费用、耗时的格式化函数，以及跨消息聚合 Token 用量的逻辑。
 *
 * Responsibilities:
 * - Token 数量、费用、耗时格式化
 * - 从多条消息中聚合所有 Token 用量记录
 * - 历史数据兼容（legacyUsage 转 TokenUsageInfo）
 *
 * Notes:
 * - 仅负责数据计算和格式化，不包含 UI 渲染。
 */

import type { Message, TokenUsageInfo } from "../types";

/**
 * 格式化 token 数，保持紧凑且可扫读。
 */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * 格式化人民币成本，小额费用保留到 8 位。
 */
export function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(value);
}

/**
 * 格式化 Agent 执行耗时。
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * 从多条消息中收集所有 token 用量记录，去重后返回。
 */
export function aggregateTokenUsages(messages: Message[]): TokenUsageInfo[] {
  const seen = new Set<string>();
  const result: TokenUsageInfo[] = [];

  for (const message of messages) {
    for (const usage of message.tokenUsages ?? []) {
      const key = usage.id ?? `${usage.agentType}-${usage.createdAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(usage);
    }

    // 兼容旧的 message.usage 汇总结构
    if (message.usage) {
      const legacy = legacyUsageToTokenUsage(message.usage);
      const key = `legacy-${message.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(legacy);
      }
    }
  }

  return result;
}

/**
 * 兼容旧的 finish.usage 汇总结构，统一转换成 token 用量行。
 */
function legacyUsageToTokenUsage(
  usage: Record<string, unknown>,
): TokenUsageInfo {
  return {
    agentType: "total",
    inputTokens: toNumber(usage.inputTokens),
    cacheHitInputTokens: toNumber(usage.cacheHitInputTokens),
    cacheMissInputTokens: toNumber(usage.cacheMissInputTokens),
    outputTokens: toNumber(usage.outputTokens),
    totalTokens: toNumber(usage.totalTokens),
    costInput: toNumber(usage.costInput),
    costOutput: toNumber(usage.costOutput),
    costTotal: toNumber(usage.costTotal),
    durationMs: toNumber(usage.durationMs),
  };
}

/**
 * 将未知数值字段转换成安全数字，避免异常 payload 撑破展示。
 */
function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

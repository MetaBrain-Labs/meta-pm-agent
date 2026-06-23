/**
 * Token 用量持久化仓库
 *
 * 负责将每个 Agent 单次调用的 token 消耗、费用和耗时写入 token_usage 表。
 *
 * Responsibilities:
 * - persistTokenUsage()：批量写入单次会话中所有 Agent 的 token 用量记录
 * - 使用 raw SQL 直接写入，不依赖 Prisma 模型（表由用户手动创建）
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

/**
 * 单个 Agent 的 token 用量记录。
 */
export interface TokenUsageRecord {
  conversationId: string;
  messageId?: string;
  agentType: string;
  inputTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  durationMs: number;
}

/**
 * 批量持久化 token 用量记录。
 * 每条记录对应一个 Agent 的一次模型调用。
 */
export async function persistTokenUsage(
  records: TokenUsageRecord[],
): Promise<void> {
  if (records.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      await tx.$executeRaw`
        INSERT INTO "token_usage" (
          "id",
          "conversation_id",
          "message_id",
          "agent_type",
          "input_tokens",
          "cache_hit_input_tokens",
          "cache_miss_input_tokens",
          "output_tokens",
          "total_tokens",
          "cost_input",
          "cost_output",
          "cost_total",
          "duration_ms"
        )
        VALUES (
          ${randomUUID()},
          ${record.conversationId},
          ${record.messageId ?? null},
          ${record.agentType},
          ${record.inputTokens},
          ${record.cacheHitInputTokens},
          ${record.cacheMissInputTokens},
          ${record.outputTokens},
          ${record.totalTokens},
          ${record.costInput},
          ${record.costOutput},
          ${record.costTotal},
          ${record.durationMs}
        )
      `;
    }
  });
}

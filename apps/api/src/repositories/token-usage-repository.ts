/**
 * Token 用量持久化仓库
 *
 * 负责将每个 Agent 单次调用的 token 消耗、费用和耗时写入 token_usage 表，
 * 并在 assistant message 创建后补充 message_id 关联，供历史会话按消息恢复。
 *
 * Responsibilities:
 * - persistTokenUsageRecord()：在单个 Agent 结束时立即写入 token 用量
 * - attachTokenUsageRecordsToMessage()：将实时写入的用量记录补充关联到消息
 * - listTokenUsageByConversation()：按会话恢复 token 用量展示数据
 *
 * Notes:
 * - 使用 raw SQL 直接访问用户手动创建的 token_usage 表，不依赖 Prisma 模型。
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
 * 前端展示所需的 token 用量 DTO。
 */
export interface TokenUsageDto extends TokenUsageRecord {
  id: string;
  messageId?: string;
  createdAt: string;
}

/**
 * token_usage 表原始查询行。
 */
interface TokenUsageRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  agent_type: string;
  input_tokens: number;
  cache_hit_input_tokens: number;
  cache_miss_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_input: unknown;
  cost_output: unknown;
  cost_total: unknown;
  duration_ms: number | null;
  created_at: Date;
}

/**
 * 在单个 Agent 结束时立即持久化 token 用量记录。
 */
export async function persistTokenUsageRecord(
  record: TokenUsageRecord,
): Promise<string> {
  const id = randomUUID();

  await prisma.$executeRaw`
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
      ${id},
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

  return id;
}

/**
 * 批量持久化 token 用量记录，保留给非流式调用或测试场景复用。
 */
export async function persistTokenUsage(
  records: TokenUsageRecord[],
): Promise<void> {
  if (records.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      const id = randomUUID();
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
          ${id},
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

/**
 * 将已实时写入的 token 用量记录关联到最终创建的 assistant message。
 */
export async function attachTokenUsageRecordsToMessage(
  tokenUsageIds: string[],
  messageId: string,
): Promise<void> {
  if (tokenUsageIds.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const tokenUsageId of tokenUsageIds) {
      await tx.$executeRaw`
        UPDATE "token_usage"
        SET "message_id" = ${messageId}
        WHERE "id" = ${tokenUsageId}
      `;
    }
  });
}

/**
 * 查询会话内所有 token 用量记录，按创建时间返回给历史消息恢复流程。
 */
export async function listTokenUsageByConversation(
  conversationId: string,
): Promise<TokenUsageDto[]> {
  const rows = await prisma.$queryRaw<TokenUsageRow[]>`
    SELECT
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
      "duration_ms",
      "created_at"
    FROM "token_usage"
    WHERE "conversation_id" = ${conversationId}
    ORDER BY "created_at" ASC, "id" ASC
  `;

  return rows.map(mapTokenUsageRow);
}

/**
 * 将数据库 snake_case 字段转换为前端/API 使用的 camelCase DTO。
 */
function mapTokenUsageRow(row: TokenUsageRow): TokenUsageDto {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id ?? undefined,
    agentType: row.agent_type,
    inputTokens: row.input_tokens,
    cacheHitInputTokens: row.cache_hit_input_tokens,
    cacheMissInputTokens: row.cache_miss_input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    costInput: toNumber(row.cost_input),
    costOutput: toNumber(row.cost_output),
    costTotal: toNumber(row.cost_total),
    durationMs: row.duration_ms ?? 0,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * 兼容 PostgreSQL numeric 在不同驱动下返回 string、number 或 Decimal 对象。
 */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    return value.toNumber();
  }
  return Number(value ?? 0);
}

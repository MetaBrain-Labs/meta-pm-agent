/**
 * 工作区提示词 override 持久化仓库
 *
 * 使用 raw SQL 访问用户手动创建的工作区提示词表，不依赖 Prisma Schema 或迁移。
 * 所有语句都按 workspace_id 过滤，保证不同工作区之间的自定义内容互不污染。
 *
 * Responsibilities:
 * - 读写单个工作区的提示词 override 记录
 * - 产出运行时所需的 override 快照（只含已注册且内容合法的条目）
 * - 幂等删除 override，供「恢复默认」使用（不复制内置默认正文）
 *
 * Notes:
 * - 表结构由 packages/database/sql/20260918_prompt_override.sql 初始化
 * - promptId 必须先通过 Prompt Registry 校验，本仓库不做注册表判断之外的路径拼接
 */

import { prisma } from "@repo/database";
import { isConfigurablePromptId, sanitizePromptOverrides } from "@repo/agent-runtime";
import type { PromptOverrides } from "@repo/shared";

interface PromptOverrideRow {
  prompt_id: string;
  content: string;
  updated_at: Date;
}

/** 单条 override 的持久化视图。 */
export interface PromptOverrideRecord {
  promptId: string;
  content: string;
  updatedAt: string;
}

/** 读取工作区全部 override 记录，未注册 id 会被忽略。 */
export async function listWorkspacePromptOverrides(
  workspaceId: string,
): Promise<PromptOverrideRecord[]> {
  const rows = await prisma.$queryRaw<PromptOverrideRow[]>`
    SELECT "prompt_id", "content", "updated_at"
    FROM "prompt_override"
    WHERE "workspace_id" = ${workspaceId}
    ORDER BY "prompt_id" ASC
  `;

  return rows
    .filter((row) => isConfigurablePromptId(row.prompt_id))
    .map((row) => ({
      promptId: row.prompt_id,
      content: row.content,
      updatedAt: row.updated_at.toISOString(),
    }));
}

/**
 * 读取运行时使用的 override 快照。
 *
 * 返回对象已经收敛到已注册 id 且通过内容校验的条目；一次 Agent Run 只解析一次，
 * 保证同一轮内所有 Agent 使用同一份不可变快照。
 *
 * 未执行建表 SQL 时按「没有任何自定义」处理，保证既有聊天与文档链路不受影响；
 * 设置页仍会通过 listWorkspacePromptOverrides 明确报错。
 */
export async function loadWorkspacePromptOverrideMap(
  workspaceId: string,
): Promise<PromptOverrides> {
  let records: PromptOverrideRecord[];
  try {
    records = await listWorkspacePromptOverrides(workspaceId);
  } catch (error) {
    if (!isMissingPromptOverrideTable(error)) throw error;
    console.warn(
      "[prompt-config] prompt_override table is missing; run packages/database/sql/20260918_prompt_override.sql to enable custom prompts.",
    );
    return {};
  }
  return sanitizePromptOverrides(
    Object.fromEntries(records.map((record) => [record.promptId, record.content])),
  );
}

/** 识别 PostgreSQL 的 undefined_table（42P01）错误，用于区分未建表与真实故障。 */
export function isMissingPromptOverrideTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; message?: string };
  };
  return (
    record.code === "42P01" ||
    record.meta?.code === "42P01" ||
    record.message?.includes("prompt_override") === true ||
    record.meta?.message?.includes("prompt_override") === true
  );
}

/** 写入或覆盖单条提示词；同一工作区同一 prompt id 只保留一份内容。 */
export async function saveWorkspacePromptOverride(input: {
  workspaceId: string;
  promptId: string;
  content: string;
}): Promise<PromptOverrideRecord> {
  const rows = await prisma.$queryRaw<PromptOverrideRow[]>`
    INSERT INTO "prompt_override" (
      "workspace_id", "prompt_id", "content"
    )
    VALUES (
      ${input.workspaceId}, ${input.promptId}, ${input.content}
    )
    ON CONFLICT ("workspace_id", "prompt_id") DO UPDATE SET
      "content" = EXCLUDED."content",
      "updated_at" = CURRENT_TIMESTAMP
    RETURNING "prompt_id", "content", "updated_at"
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to save prompt override.");
  }
  return {
    promptId: row.prompt_id,
    content: row.content,
    updatedAt: row.updated_at.toISOString(),
  };
}

/** 删除单条 override；不存在时返回 false，保证「恢复默认」幂等。 */
export async function deleteWorkspacePromptOverride(input: {
  workspaceId: string;
  promptId: string;
}): Promise<boolean> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM "prompt_override"
    WHERE "workspace_id" = ${input.workspaceId}
      AND "prompt_id" = ${input.promptId}
  `;
  return deleted > 0;
}

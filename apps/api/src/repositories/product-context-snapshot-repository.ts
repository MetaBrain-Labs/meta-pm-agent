/**
 * 产品上下文快照仓库
 *
 * 通过 raw SQL 访问可选的 product_context_snapshot 表。该表保存比
 * product_knowledge_graph 更完整的运行时上下文快照，用于 resources 文件缺失时恢复
 * 新项目或项目演化的上下文。
 *
 * Responsibilities:
 * - upsertProductContextSnapshot()：按 workspace 保存最新上下文快照
 * - getProductContextSnapshotByWorkspaceId()：读取当前 workspace 快照
 * - clearProductContextSnapshotByWorkspaceId()：清理当前 workspace 快照
 *
 * Notes:
 * - 表结构由 packages/database/sql/20260914_runtime_tables.sql 初始化。
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

/**
 * 产品上下文快照的持久化输入。
 */
export interface PersistProductContextSnapshotInput {
  workspaceId: string;
  conversationId?: string;
  requestFormId?: string;
  context: unknown;
  advanceVersion?: boolean;
}

/**
 * product_context_snapshot 表读取行。
 */
export interface ProductContextSnapshotRow {
  context: unknown;
  version: number;
  updatedAt: string;
  conversationId?: string;
  requestFormId?: string;
}

/**
 * 按工作区保存最新产品上下文快照。
 */
export async function upsertProductContextSnapshot({
  workspaceId,
  conversationId,
  requestFormId,
  context,
  advanceVersion = true,
}: PersistProductContextSnapshotInput): Promise<void> {
  const contextJson = JSON.stringify(context);

  await prisma.$executeRaw`
    INSERT INTO "product_context_snapshot" (
      "id",
      "workspace_id",
      "conversation_id",
      "request_form_id",
      "context_json",
      "version"
    )
    VALUES (
      ${randomUUID()},
      ${workspaceId},
      ${conversationId ?? null},
      ${requestFormId ?? null},
      ${contextJson}::jsonb,
      1
    )
    ON CONFLICT ("workspace_id") DO UPDATE
    SET
      "conversation_id" = CASE
        WHEN ${advanceVersion} THEN EXCLUDED."conversation_id"
        ELSE "product_context_snapshot"."conversation_id"
      END,
      "request_form_id" = CASE
        WHEN ${advanceVersion} THEN EXCLUDED."request_form_id"
        ELSE "product_context_snapshot"."request_form_id"
      END,
      "context_json" = EXCLUDED."context_json",
      "version" = CASE
        WHEN ${advanceVersion}
          AND "product_context_snapshot"."request_form_id" IS DISTINCT FROM EXCLUDED."request_form_id"
          THEN "product_context_snapshot"."version" + 1
        ELSE "product_context_snapshot"."version"
      END,
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

/**
 * 按工作区读取最新产品上下文快照。
 */
export async function getProductContextSnapshotByWorkspaceId(
  workspaceId: string,
): Promise<ProductContextSnapshotRow | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      context_json: unknown;
      version: number;
      updated_at: Date;
      conversation_id: string | null;
      request_form_id: string | null;
    }>
  >`
    SELECT
      "context_json",
      "version",
      "updated_at",
      "conversation_id",
      "request_form_id"
    FROM "product_context_snapshot"
    WHERE "workspace_id" = ${workspaceId}
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    context: row.context_json,
    version: Number(row.version),
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.request_form_id ? { requestFormId: row.request_form_id } : {}),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

/**
 * 清理指定工作区的产品上下文快照。
 */
export async function clearProductContextSnapshotByWorkspaceId(
  workspaceId: string,
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "product_context_snapshot"
    WHERE "workspace_id" = ${workspaceId}
  `;
}

/**
 * 产品知识图谱持久化仓库
 *
 * 通过 raw SQL 访问用户维护的 product_knowledge_graph 表。长期持久化只保留
 * nodes 和 relations 两类图谱事实，避免 summary、decisions、risks、
 * open_questions 与图谱节点关系形成重复事实源。
 *
 * Responsibilities:
 * - upsertProductKnowledgeGraph()：按 workspace 保存最新图谱节点和关系
 * - getProductKnowledgeGraphByWorkspaceId()：读取当前 workspace 图谱快照
 * - clearProductKnowledgeGraphByWorkspaceId()：清空当前 workspace 的图谱快照
 * - 维护 conversation/request_form provenance 与图谱版本号
 *
 * Notes:
 * - 运行时 ProductKnowledgeGraph 仍可携带临时 summary/decision/risk/question。
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

/**
 * 最终产品知识图谱的持久化输入。
 */
export interface PersistProductKnowledgeGraphInput {
  workspaceId: string;
  conversationId?: string;
  requestFormId?: string;
  /** 是否把本次写入计为一轮完成的知识图谱版本。 */
  advanceVersion?: boolean;
  /** 结构化知识图谱节点。 */
  nodes?: unknown[];
  /** 结构化知识图谱关系。 */
  relations?: unknown[];
}

/**
 * 按工作区保存最新产品知识图谱；一个工作区只保留一份当前图谱。
 */
export async function upsertProductKnowledgeGraph({
  workspaceId,
  conversationId,
  requestFormId,
  advanceVersion = true,
  nodes,
  relations,
}: PersistProductKnowledgeGraphInput): Promise<void> {
  const nodesJson = nodes && nodes.length > 0 ? JSON.stringify(nodes) : null;
  const relationsJson =
    relations && relations.length > 0 ? JSON.stringify(relations) : null;

  await prisma.$executeRaw`
    INSERT INTO "product_knowledge_graph" (
      "id",
      "workspace_id",
      "conversation_id",
      "request_form_id",
      "nodes",
      "relations",
      "version"
    )
    VALUES (
      ${randomUUID()},
      ${workspaceId},
      ${conversationId ?? null},
      ${requestFormId ?? null},
      ${nodesJson}::jsonb,
      ${relationsJson}::jsonb,
      1
    )
    ON CONFLICT ("workspace_id") DO UPDATE
    SET
      "conversation_id" = CASE
        WHEN ${advanceVersion} THEN EXCLUDED."conversation_id"
        ELSE "product_knowledge_graph"."conversation_id"
      END,
      "request_form_id" = CASE
        WHEN ${advanceVersion} THEN EXCLUDED."request_form_id"
        ELSE "product_knowledge_graph"."request_form_id"
      END,
      "nodes" = EXCLUDED."nodes",
      "relations" = EXCLUDED."relations",
      "version" = CASE
        WHEN ${advanceVersion}
          AND "product_knowledge_graph"."request_form_id" IS DISTINCT FROM EXCLUDED."request_form_id"
          THEN "product_knowledge_graph"."version" + 1
        ELSE "product_knowledge_graph"."version"
      END,
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

/**
 * product_knowledge_graph 表读取行。
 */
export interface ProductKnowledgeGraphRow {
  nodes: unknown[];
  relations: unknown[];
  version: number;
  updatedAt: string;
}

/**
 * 按工作区 ID 查询产品知识图谱记录。
 */
export async function getProductKnowledgeGraphByWorkspaceId(
  workspaceId: string,
): Promise<ProductKnowledgeGraphRow | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      nodes: unknown;
      relations: unknown;
      version: number;
      updated_at: Date;
    }>
  >`
    SELECT
      "nodes",
      "relations",
      "version",
      "updated_at"
    FROM "product_knowledge_graph"
    WHERE "workspace_id" = ${workspaceId}
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    nodes: parseJsonColumn(row.nodes, []),
    relations: parseJsonColumn(row.relations, []),
    version: Number(row.version),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

/**
 * 清空指定工作区当前产品知识图谱，用于用户确认在同一工作区开始新项目。
 */
export async function clearProductKnowledgeGraphByWorkspaceId(
  workspaceId: string,
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "product_knowledge_graph"
    WHERE "workspace_id" = ${workspaceId}
  `;
}

/**
 * 安全解析 JSONB 列数据，兼容已经是对象/数组的情况。
 */
function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return value as unknown as T;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

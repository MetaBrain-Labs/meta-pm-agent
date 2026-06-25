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
  /** 结构化知识图谱数据：摘要 */
  summary?: unknown[];
  /** 结构化知识图谱数据：节点 */
  nodes?: unknown[];
  /** 结构化知识图谱数据：关系 */
  relations?: unknown[];
  /** 结构化知识图谱数据：决策 */
  decisions?: unknown[];
  /** 结构化知识图谱数据：风险 */
  risks?: unknown[];
  /** 结构化知识图谱数据：待确认问题 */
  openQuestions?: unknown[];
}

/**
 * 按工作区保存最新产品知识图谱；一个工作区只保留一份当前图谱。
 * 结构化数据拆分到独立 JSONB 列中，方便后续按类型查询和 markdown 拼凑。
 */
export async function upsertProductKnowledgeGraph({
  workspaceId,
  conversationId,
  requestFormId,
  advanceVersion = true,
  summary,
  nodes,
  relations,
  decisions,
  risks,
  openQuestions,
}: PersistProductKnowledgeGraphInput): Promise<void> {
  const summaryJson =
    summary && summary.length > 0 ? JSON.stringify(summary) : null;
  const nodesJson = nodes && nodes.length > 0 ? JSON.stringify(nodes) : null;
  const relationsJson =
    relations && relations.length > 0 ? JSON.stringify(relations) : null;
  const decisionsJson =
    decisions && decisions.length > 0 ? JSON.stringify(decisions) : null;
  const risksJson = risks && risks.length > 0 ? JSON.stringify(risks) : null;
  const openQuestionsJson =
    openQuestions && openQuestions.length > 0
      ? JSON.stringify(openQuestions)
      : null;

  await prisma.$executeRaw`
    INSERT INTO "product_knowledge_graph" (
      "id",
      "workspace_id",
      "conversation_id",
      "request_form_id",
      "summary",
      "nodes",
      "relations",
      "decisions",
      "risks",
      "open_questions",
      "version"
    )
    VALUES (
      ${randomUUID()},
      ${workspaceId},
      ${conversationId ?? null},
      ${requestFormId ?? null},
      ${summaryJson}::jsonb,
      ${nodesJson}::jsonb,
      ${relationsJson}::jsonb,
      ${decisionsJson}::jsonb,
      ${risksJson}::jsonb,
      ${openQuestionsJson}::jsonb,
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
      "summary" = EXCLUDED."summary",
      "nodes" = EXCLUDED."nodes",
      "relations" = EXCLUDED."relations",
      "decisions" = EXCLUDED."decisions",
      "risks" = EXCLUDED."risks",
      "open_questions" = EXCLUDED."open_questions",
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
 * 按工作区 ID 查询产品知识图谱记录，返回结构化列数据。
 * 如果工作区尚无图谱记录则返回 null。
 */
export interface ProductKnowledgeGraphRow {
  summary: unknown[];
  nodes: unknown[];
  relations: unknown[];
  decisions: unknown[];
  risks: unknown[];
  openQuestions: unknown[];
  version: number;
  updatedAt: string;
}

export async function getProductKnowledgeGraphByWorkspaceId(
  workspaceId: string,
): Promise<ProductKnowledgeGraphRow | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      summary: unknown;
      nodes: unknown;
      relations: unknown;
      decisions: unknown;
      risks: unknown;
      open_questions: unknown;
      version: number;
      updated_at: Date;
    }>
  >`
    SELECT
      "summary",
      "nodes",
      "relations",
      "decisions",
      "risks",
      "open_questions",
      "version",
      "updated_at"
    FROM "product_knowledge_graph"
    WHERE "workspace_id" = ${workspaceId}
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    summary: parseJsonColumn(row.summary, []),
    nodes: parseJsonColumn(row.nodes, []),
    relations: parseJsonColumn(row.relations, []),
    decisions: parseJsonColumn(row.decisions, []),
    risks: parseJsonColumn(row.risks, []),
    openQuestions: parseJsonColumn(row.open_questions, []),
    version: Number(row.version),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
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

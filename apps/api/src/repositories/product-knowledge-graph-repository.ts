import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type { ProductKnowledgeGraph } from "@repo/shared";

/**
 * 最终产品知识图谱的持久化输入。
 */
export interface PersistProductKnowledgeGraphInput {
  workspaceId: string;
  conversationId?: string;
  requestFormId?: string;
  /** 由结构化数据生成的 markdown 文本 */
  markdown: string;
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
  markdown,
  summary,
  nodes,
  relations,
  decisions,
  risks,
  openQuestions,
}: PersistProductKnowledgeGraphInput): Promise<void> {
  const summaryJson = summary && summary.length > 0
    ? JSON.stringify(summary)
    : null;
  const nodesJson = nodes && nodes.length > 0
    ? JSON.stringify(nodes)
    : null;
  const relationsJson = relations && relations.length > 0
    ? JSON.stringify(relations)
    : null;
  const decisionsJson = decisions && decisions.length > 0
    ? JSON.stringify(decisions)
    : null;
  const risksJson = risks && risks.length > 0
    ? JSON.stringify(risks)
    : null;
  const openQuestionsJson = openQuestions && openQuestions.length > 0
    ? JSON.stringify(openQuestions)
    : null;

  await prisma.$executeRaw`
    INSERT INTO "product_knowledge_graph" (
      "id",
      "workspace_id",
      "conversation_id",
      "request_form_id",
      "content",
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
      ${markdown},
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
      "conversation_id" = EXCLUDED."conversation_id",
      "request_form_id" = EXCLUDED."request_form_id",
      "content" = EXCLUDED."content",
      "summary" = EXCLUDED."summary",
      "nodes" = EXCLUDED."nodes",
      "relations" = EXCLUDED."relations",
      "decisions" = EXCLUDED."decisions",
      "risks" = EXCLUDED."risks",
      "open_questions" = EXCLUDED."open_questions",
      "version" = "product_knowledge_graph"."version" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

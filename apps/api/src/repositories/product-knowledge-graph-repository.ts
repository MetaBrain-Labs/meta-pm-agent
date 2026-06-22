import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";

/**
 * 最终产品知识图谱的持久化输入。
 */
export interface PersistProductKnowledgeGraphInput {
  workspaceId: string;
  conversationId?: string;
  requestFormId?: string;
  markdown: string;
}

/**
 * 按工作区保存最新产品知识图谱；一个工作区只保留一份当前图谱。
 */
export async function upsertProductKnowledgeGraph({
  workspaceId,
  conversationId,
  requestFormId,
  markdown,
}: PersistProductKnowledgeGraphInput): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "product_knowledge_graph" (
      "id",
      "workspace_id",
      "conversation_id",
      "request_form_id",
      "content",
      "version"
    )
    VALUES (
      ${randomUUID()},
      ${workspaceId},
      ${conversationId ?? null},
      ${requestFormId ?? null},
      ${markdown},
      1
    )
    ON CONFLICT ("workspace_id") DO UPDATE
    SET
      "conversation_id" = EXCLUDED."conversation_id",
      "request_form_id" = EXCLUDED."request_form_id",
      "content" = EXCLUDED."content",
      "version" = "product_knowledge_graph"."version" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

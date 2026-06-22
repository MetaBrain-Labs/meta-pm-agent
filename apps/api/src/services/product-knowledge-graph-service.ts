import {
  deleteWorkspaceKnowledgeGraphFile,
  readWorkspaceKnowledgeGraphFile,
} from "@repo/agent-runtime";
import { upsertProductKnowledgeGraph } from "../repositories/product-knowledge-graph-repository";

/**
 * 归档输入，关联本轮会话与请求表单，便于后续审计最终图谱来源。
 */
export interface FinalizeProductKnowledgeGraphInput {
  workspaceId?: string;
  conversationId?: string;
  requestFormId?: string;
}

/**
 * 将工作区运行时知识图谱归档到数据库，并在落库成功后删除临时文件。
 */
export async function finalizeWorkspaceKnowledgeGraph({
  workspaceId,
  conversationId,
  requestFormId,
}: FinalizeProductKnowledgeGraphInput): Promise<void> {
  if (!workspaceId) return;

  const markdown = readWorkspaceKnowledgeGraphFile(workspaceId);
  if (!markdown?.trim()) return;

  await upsertProductKnowledgeGraph({
    workspaceId,
    conversationId,
    requestFormId,
    markdown,
  });

  // 只有数据库写入成功后才清理运行时文件，避免异常时丢失图谱。
  deleteWorkspaceKnowledgeGraphFile(workspaceId);
}

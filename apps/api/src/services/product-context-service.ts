/**
 * 产品运行上下文服务
 *
 * 根据会话和工作区加载产品概述文档与当前产品知识图谱，为 Conversation Agent、
 * Request Agent 和产品工作流提供可恢复的上下文输入。
 *
 * Responsibilities:
 * - 根据 conversationId 找到 workspace 并读取产品概述文件
 * - 从 product_knowledge_graph.nodes/relations 恢复运行时 ProductKnowledgeGraph
 * - 将持久化节点中的 Decision/Risk/OpenQuestion 还原为运行时辅助数组
 *
 * Notes:
 * - 不负责写入知识图谱，持久化归档由 product-knowledge-graph-service 处理。
 */

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  KnowledgeGraphDecisionInput,
  KnowledgeGraphEntity,
  KnowledgeGraphOpenQuestionInput,
  KnowledgeGraphRelation,
  KnowledgeGraphRiskInput,
  OrchestratorContextSource,
  ProductKnowledgeGraph,
} from "@repo/shared";
import { ProductKnowledgeGraphSchema } from "@repo/shared";
import { getConversationWorkspace } from "../repositories/chat-repository";
import { getProductContextSnapshotByWorkspaceId } from "../repositories/product-context-snapshot-repository";
import { getProductKnowledgeGraphByWorkspaceId } from "../repositories/product-knowledge-graph-repository";
import { readProductContextResourceSnapshot } from "./product-context-resource-service";

const MAX_CONTEXT_CHARS = 24_000;

// 只读取概述性文档。Request Agent 需要项目背景，不需要扫描整个工作区，
// 这样可以避免把无关文件带入提示词。
const OVERVIEW_FILES = [
  "README.md",
  "README-zh.md",
  "overview.md",
  "product-context.md",
  "product-overview.md",
  "product-draft.md",
  "docs/overview.md",
  "docs/product-context.md",
  "docs/product-overview.md",
  "docs/product-draft.md",
];

/**
 * Agent 运行所需的工作区上下文。
 */
export interface ProductRuntimeContext {
  workspaceId?: string;
  productContext: string;
  contextSource: OrchestratorContextSource;
  knowledgeGraph?: ProductKnowledgeGraph | null;
}

/**
 * 根据会话 ID 加载工作区 ID 与产品概述上下文。
 */
export async function loadProductRuntimeContextForConversation(
  conversationId: string | undefined,
): Promise<ProductRuntimeContext> {
  if (!conversationId) {
    return { productContext: "", contextSource: "none" };
  }

  const workspace = await getConversationWorkspace(conversationId);
  if (!workspace) {
    return { productContext: "", contextSource: "none" };
  }
  const graphContext = await loadProductKnowledgeGraphForWorkspace(
    workspace.workspaceId,
  );

  return {
    workspaceId: workspace.workspaceId,
    productContext: await loadProductContextForWorkspace(workspace),
    contextSource: graphContext.contextSource,
    knowledgeGraph: graphContext.knowledgeGraph,
  };
}

/**
 * 加载工作区当前结构化知识图谱，供 runtime 恢复和后续规划使用。
 */
async function loadProductKnowledgeGraphForWorkspace(
  workspaceId: string,
): Promise<{
  knowledgeGraph: ProductKnowledgeGraph | null;
  contextSource: OrchestratorContextSource;
}> {
  const persistedGraph =
    await loadPersistedKnowledgeGraphFromDatabase(workspaceId);
  const resourceSnapshot = await readProductContextResourceSnapshot(workspaceId);
  if (resourceSnapshot) {
    return {
      knowledgeGraph: mergeProductContextSnapshotWithPersistedGraph(
        resourceSnapshot.knowledgeGraph,
        persistedGraph,
      ),
      contextSource: "resources",
    };
  }

  const dbSnapshot = await loadProductContextSnapshotFromDatabase(workspaceId);
  if (dbSnapshot) {
    return {
      knowledgeGraph: mergeProductContextSnapshotWithPersistedGraph(
        dbSnapshot,
        persistedGraph,
      ),
      contextSource: "database",
    };
  }

  if (!persistedGraph) return { knowledgeGraph: null, contextSource: "none" };

  return {
    knowledgeGraph: persistedGraph,
    contextSource: "product_knowledge_graph",
  };
}

/**
 * 从长期知识图谱表恢复 nodes/relations，供产品上下文快照按需合并。
 */
async function loadPersistedKnowledgeGraphFromDatabase(
  workspaceId: string,
): Promise<ProductKnowledgeGraph | null> {
  const row = await getProductKnowledgeGraphByWorkspaceId(workspaceId);
  if (!row) return null;

  const nodes = removeLegacyDecisionAliases(
    asArray<KnowledgeGraphEntity>(row.nodes),
  );

  return {
    entities: nodes.filter(
      (node) => node.type !== "Risk" && node.type !== "OpenQuestion",
    ),
    relations: asArray<KnowledgeGraphRelation>(row.relations),
    decisions: restoreDecisionInputs(nodes),
    risks: restoreRiskInputs(nodes),
    open_questions: restoreOpenQuestionInputs(nodes),
    summary: [],
    markdown: "",
    notes: [],
  };
}

/**
 * 加载历史图谱时折叠 DEC-* / D-* 双写，避免恢复后 Decision 数量漂移。
 */
function removeLegacyDecisionAliases(
  nodes: KnowledgeGraphEntity[],
): KnowledgeGraphEntity[] {
  const ids = new Set(nodes.map((node) => node.id));
  return nodes.filter((node) => {
    const match = node.type === "Decision" ? /^DEC-(\d+)$/i.exec(node.id) : null;
    return !match || !ids.has(`D-${match[1]}`);
  });
}

/**
 * 将不含 nodes/relations 的产品上下文快照与长期知识图谱合并成运行时图谱。
 */
function mergeProductContextSnapshotWithPersistedGraph(
  snapshot: ProductKnowledgeGraph,
  persistedGraph: ProductKnowledgeGraph | null,
): ProductKnowledgeGraph {
  if (!persistedGraph) return snapshot;

  return {
    ...snapshot,
    entities: persistedGraph.entities,
    relations: persistedGraph.relations,
    decisions: mergeAuxiliaryItems(snapshot.decisions, persistedGraph.decisions),
    risks: mergeAuxiliaryItems(snapshot.risks, persistedGraph.risks),
    open_questions: mergeAuxiliaryItems(
      snapshot.open_questions,
      persistedGraph.open_questions,
    ),
  };
}

/**
 * 按 ID 合并运行时辅助上下文，优先保留 snapshot 中更新的内容。
 */
function mergeAuxiliaryItems<T extends { id: string }>(
  snapshotItems: T[],
  persistedItems: T[],
): T[] {
  const merged = new Map(persistedItems.map((item) => [item.id, item]));
  for (const item of snapshotItems) {
    merged.set(item.id, item);
  }

  return [...merged.values()];
}

/**
 * 从可选快照表恢复完整运行时上下文；表未创建时安静降级。
 */
async function loadProductContextSnapshotFromDatabase(
  workspaceId: string,
): Promise<ProductKnowledgeGraph | null> {
  try {
    const row = await getProductContextSnapshotByWorkspaceId(workspaceId);
    if (!row) return null;
    return parseProductContextSnapshotGraph(row.context);
  } catch (error) {
    if (isMissingOptionalSnapshotTableError(error)) return null;
    throw error;
  }
}

/**
 * 从 DB context_json 中提取 ProductKnowledgeGraph。
 */
function parseProductContextSnapshotGraph(
  context: unknown,
): ProductKnowledgeGraph | null {
  const graphCandidate =
    context && typeof context === "object" && "knowledgeGraph" in context
      ? (context as { knowledgeGraph?: unknown }).knowledgeGraph
      : context;
  const result = ProductKnowledgeGraphSchema.safeParse(graphCandidate);
  return result.success ? result.data : null;
}

/**
 * 从持久化 nodes 中恢复运行时决策数组，供后续 Planner/Executor 使用。
 */
function restoreDecisionInputs(
  nodes: KnowledgeGraphEntity[],
): KnowledgeGraphDecisionInput[] {
  return nodes
    .filter((node) => node.type === "Decision")
    .map((node) => ({
      id: node.id,
      text: node.description || node.name,
      ...(node.source_task_id ? { source_task_id: node.source_task_id } : {}),
    }));
}

/**
 * 从持久化 nodes 中恢复运行时风险数组。
 */
function restoreRiskInputs(nodes: KnowledgeGraphEntity[]): KnowledgeGraphRiskInput[] {
  return nodes
    .filter((node) => node.type === "Risk")
    .map((node) => ({
      id: node.id,
      text: node.description || node.name,
      ...(node.source_task_id ? { source_task_id: node.source_task_id } : {}),
    }));
}

/**
 * 从持久化 nodes 中恢复运行时待确认问题数组。
 */
function restoreOpenQuestionInputs(
  nodes: KnowledgeGraphEntity[],
): KnowledgeGraphOpenQuestionInput[] {
  return nodes
    .filter((node) => node.type === "OpenQuestion")
    .map((node) => ({
      id: node.id,
      text: node.description || node.name,
      blocking: node.blocking ?? false,
      ...(node.source_task_id ? { source_task_id: node.source_task_id } : {}),
    }));
}

/**
 * 将 JSONB 读取结果约束为数组。
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * 仅保留字符串摘要。
 */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * 判断可选 product_context_snapshot 表是否尚未创建。
 */
function isMissingOptionalSnapshotTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("product_context_snapshot") &&
    (message.includes("42P01") ||
      message.includes("does not exist") ||
      message.includes("不存在"))
  );
}

/**
 * 根据会话 ID 加载对应工作区的产品概述上下文，供 Request Agent 使用。
 * 只读取预定义的概述性文档，避免将整个工作区文件带入提示词。
 */
export async function loadProductContextForConversation(
  conversationId: string | undefined,
): Promise<string> {
  const context =
    await loadProductRuntimeContextForConversation(conversationId);
  return context.productContext;
}

/**
 * 从工作区概述文件中拼接产品上下文。
 */
async function loadProductContextForWorkspace(
  workspace: Awaited<ReturnType<typeof getConversationWorkspace>>,
): Promise<string> {
  if (!workspace?.localPath) return "";

  const sections: string[] = [`Workspace: ${workspace.workspaceName}`];

  for (const relativeFile of OVERVIEW_FILES) {
    const filePath = path.resolve(workspace.localPath, relativeFile);

    // 候选文件必须位于用户选择的工作区内，避免相对路径逃逸到工作区之外。
    if (!isInsideDirectory(filePath, workspace.localPath)) continue;

    const content = await readTextFileIfExists(filePath);
    if (!content) continue;

    sections.push(`## ${relativeFile}\n${content}`);
    if (sections.join("\n\n").length >= MAX_CONTEXT_CHARS) break;
  }

  return sections.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
}

/**
 * 读取文件内容，文件不存在时返回 null 而非抛出异常。
 */
async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 检查文件路径是否位于指定目录之内，防止路径遍历逃逸到工作区外部。
 */
function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), filePath);

  // 当 filePath 位于目录外时，path.relative 会返回以 ".." 开头或绝对路径的结果。
  // 这里用这个特征做跨平台的目录边界检查。
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

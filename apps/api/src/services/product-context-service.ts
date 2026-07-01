import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  ProductKnowledgeGraph,
} from "@repo/shared";
import { getConversationWorkspace } from "../repositories/chat-repository";
import { getProductKnowledgeGraphByWorkspaceId } from "../repositories/product-knowledge-graph-repository";

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
  knowledgeGraph?: ProductKnowledgeGraph | null;
}

/**
 * 根据会话 ID 加载工作区 ID 与产品概述上下文。
 */
export async function loadProductRuntimeContextForConversation(
  conversationId: string | undefined,
): Promise<ProductRuntimeContext> {
  if (!conversationId) {
    return { productContext: "" };
  }

  const workspace = await getConversationWorkspace(conversationId);
  if (!workspace) {
    return { productContext: "" };
  }

  return {
    workspaceId: workspace.workspaceId,
    productContext: await loadProductContextForWorkspace(workspace),
    knowledgeGraph: await loadProductKnowledgeGraphForWorkspace(
      workspace.workspaceId,
    ),
  };
}

/**
 * 加载工作区当前结构化知识图谱，供 runtime 恢复和后续规划使用。
 */
async function loadProductKnowledgeGraphForWorkspace(
  workspaceId: string,
): Promise<ProductKnowledgeGraph | null> {
  const row = await getProductKnowledgeGraphByWorkspaceId(workspaceId);
  if (!row) return null;

  return {
    entities: asArray<KnowledgeGraphEntity>(row.nodes),
    relations: asArray<KnowledgeGraphRelation>(row.relations),
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    markdown: "",
    notes: [],
  };
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

  console.log("sections:", sections);

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

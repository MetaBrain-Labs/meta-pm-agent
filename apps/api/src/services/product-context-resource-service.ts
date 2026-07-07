/**
 * 产品上下文 resources 快照服务
 *
 * 负责把运行时 ProductKnowledgeGraph 快照保存到仓库根目录的 resources/product-contexts
 * 下，并在工作流启动时优先读取该目录中的最新上下文。该层由后端代码读写，
 * 不向模型暴露任意文件系统工具。
 *
 * Responsibilities:
 * - readProductContextResourceSnapshot()：读取工作区上下文快照
 * - writeProductContextResourceSnapshot()：写入工作区上下文快照
 * - clearProductContextResourceSnapshot()：清理工作区上下文快照
 *
 * Notes:
 * - 该目录保存运行时数据，生成的 JSON 文件不应提交到 Git。
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProductKnowledgeGraphSchema,
  type ProductKnowledgeGraph,
} from "@repo/shared";

const DEFAULT_RESOURCE_CONTEXT_DIR = fileURLToPath(
  new URL("../../../../resources/product-contexts/", import.meta.url),
);

/**
 * resources 快照的磁盘结构。
 */
export interface ProductContextResourceSnapshot {
  version: 1;
  workspaceId: string;
  conversationId?: string;
  requestFormId?: string;
  updatedAt: string;
  knowledgeGraph: ProductKnowledgeGraph;
}

/**
 * 读取指定工作区的 resources 上下文快照。
 */
export async function readProductContextResourceSnapshot(
  workspaceId: string,
): Promise<ProductContextResourceSnapshot | null> {
  const filePath = getWorkspaceSnapshotPath(workspaceId);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseProductContextResourceSnapshot(parsed, workspaceId);
  } catch {
    return null;
  }
}

/**
 * 写入指定工作区的 resources 上下文快照。
 */
export async function writeProductContextResourceSnapshot({
  workspaceId,
  conversationId,
  requestFormId,
  knowledgeGraph,
}: {
  workspaceId: string;
  conversationId?: string;
  requestFormId?: string;
  knowledgeGraph: ProductKnowledgeGraph;
}): Promise<void> {
  const dir = getResourceContextDirectory();
  await mkdir(dir, { recursive: true });

  const snapshot: ProductContextResourceSnapshot = {
    version: 1,
    workspaceId,
    ...(conversationId ? { conversationId } : {}),
    ...(requestFormId ? { requestFormId } : {}),
    updatedAt: new Date().toISOString(),
    knowledgeGraph,
  };
  await writeFile(
    getWorkspaceSnapshotPath(workspaceId),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

/**
 * 清理指定工作区的 resources 上下文快照。
 */
export async function clearProductContextResourceSnapshot(
  workspaceId: string,
): Promise<void> {
  try {
    await rm(getWorkspaceSnapshotPath(workspaceId), { force: true });
  } catch {
    // resources 快照不存在时无需阻断清理数据库图谱。
  }
}

/**
 * 解析并校验 resources 快照，避免损坏文件污染运行时。
 */
function parseProductContextResourceSnapshot(
  value: unknown,
  workspaceId: string,
): ProductContextResourceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.workspaceId !== workspaceId) return null;

  const graphResult = ProductKnowledgeGraphSchema.safeParse(
    record.knowledgeGraph,
  );
  if (!graphResult.success) return null;

  return {
    version: 1,
    workspaceId,
    conversationId:
      typeof record.conversationId === "string"
        ? record.conversationId
        : undefined,
    requestFormId:
      typeof record.requestFormId === "string"
        ? record.requestFormId
        : undefined,
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date(0).toISOString(),
    knowledgeGraph: graphResult.data,
  };
}

/**
 * 获取 resources 上下文目录，允许部署环境通过环境变量改写位置。
 */
function getResourceContextDirectory(): string {
  return path.resolve(
    process.env.PRODUCT_CONTEXT_RESOURCE_DIR || DEFAULT_RESOURCE_CONTEXT_DIR,
  );
}

/**
 * 生成当前工作区快照文件路径。
 */
function getWorkspaceSnapshotPath(workspaceId: string): string {
  return path.join(getResourceContextDirectory(), `${safeFileName(workspaceId)}.json`);
}

/**
 * 收敛文件名字符，避免工作区 ID 被误用为路径片段。
 */
function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

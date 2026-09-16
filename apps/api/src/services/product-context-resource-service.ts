/**
 * 产品上下文 resources 快照服务
 *
 * 负责把运行时 ProductKnowledgeGraph 快照保存到项目的 resources/product-contexts
 * 下，并兼容旧集中目录。该层由后端代码读写，
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

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  ProductKnowledgeGraphSchema,
  type ProductKnowledgeGraph,
} from "@repo/shared";
import {
  copyLocalFile, localFileId, readLocalFile, removeLocalFile,
  workspaceLocalPaths, writeLocalFile,
} from "./workspace-local-file-service";

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
  localPath?: string | null,
): Promise<ProductContextResourceSnapshot | null> {
  try {
    if (localPath) {
      const paths = workspaceLocalPaths(localPath, workspaceId);
      const raw = await readLocalFile(localPath, paths.context);
      // 已存在但损坏的项目快照直接降级数据库，不恢复集中目录中的旧副本。
      if (raw !== null) return parseProductContextResourceSnapshot(JSON.parse(raw), workspaceId);
      if (await readLocalFile(localPath, paths.retired) !== null) return null;
    }
    const legacyRoot = getResourceContextDirectory();
    const raw = await readLocalFile(legacyRoot, getWorkspaceSnapshotPath(workspaceId));
    if (raw === null) return null;
    const snapshot = parseProductContextResourceSnapshot(JSON.parse(raw), workspaceId);
    if (snapshot && localPath) {
      try {
        await copyProductContextResourceSnapshot(localPath, snapshot);
      } catch {
        // 本地复制失败时仍允许本次使用有效旧快照，状态接口会显示缺失。
      }
    }
    return snapshot;
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
  localPath,
}: {
  workspaceId: string;
  conversationId?: string;
  requestFormId?: string;
  knowledgeGraph: ProductKnowledgeGraph;
  localPath?: string | null;
}): Promise<void> {
  const snapshot: ProductContextResourceSnapshot = {
    version: 1,
    workspaceId,
    ...(conversationId ? { conversationId } : {}),
    ...(requestFormId ? { requestFormId } : {}),
    updatedAt: new Date().toISOString(),
    knowledgeGraph,
  };
  const root = localPath || getResourceContextDirectory();
  const target = localPath ? workspaceLocalPaths(localPath, workspaceId).context : getWorkspaceSnapshotPath(workspaceId);
  await writeLocalFile(root, target, `${JSON.stringify(snapshot, null, 2)}\n`);
  if (localPath) await retireLegacySnapshot(localPath, workspaceId);
}

/** 无覆盖复制有效快照，成功后记住集中目录副本已退役。 */
export async function copyProductContextResourceSnapshot(localPath: string, snapshot: ProductContextResourceSnapshot): Promise<void> {
  const target = workspaceLocalPaths(localPath, snapshot.workspaceId).context;
  const existing = await readLocalFile(localPath, target);
  // 快照格式和更新时间差异不能造成同一份业务上下文的复制冲突。
  if (existing !== null) {
    const parsed = parseProductContextResourceSnapshot(JSON.parse(existing), snapshot.workspaceId);
    if (!parsed || !isDeepStrictEqual(parsed.knowledgeGraph, snapshot.knowledgeGraph)) {
      throw new Error("目标已有不同内容，未覆盖；请保留或移开该文件后重新同步。");
    }
  } else {
    await copyLocalFile(localPath, target, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  await retireLegacySnapshot(localPath, snapshot.workspaceId);
}

/** 保留退役标记，快照被清空或意外删除后不会读回旧集中副本。 */
export async function retireLegacySnapshot(localPath: string, workspaceId: string): Promise<void> {
  await copyLocalFile(localPath, workspaceLocalPaths(localPath, workspaceId).retired, "1\n");
}

/**
 * 清理指定工作区的 resources 上下文快照。
 */
export async function clearProductContextResourceSnapshot(
  workspaceId: string,
  localPath?: string | null,
): Promise<void> {
  if (localPath) {
    await retireLegacySnapshot(localPath, workspaceId);
    await removeLocalFile(localPath, workspaceLocalPaths(localPath, workspaceId).context);
  } else {
    await removeLocalFile(getResourceContextDirectory(), getWorkspaceSnapshotPath(workspaceId));
  }
}

/**
 * 解析并校验 resources 快照，避免损坏文件污染运行时。
 */
export function parseProductContextResourceSnapshot(
  value: unknown,
  workspaceId: string,
): ProductContextResourceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.workspaceId !== workspaceId) return null;

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
 * 获取旧集中上下文目录，环境变量仅定位旧数据和无项目根目录的兼容调用。
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
  return path.join(getResourceContextDirectory(), `${localFileId(workspaceId)}.json`);
}

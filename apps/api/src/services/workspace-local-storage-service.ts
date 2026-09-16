/**
 * 工作区本地产物同步服务
 *
 * Responsibilities:
 * - 对照数据库计算可恢复的磁盘同步状态
 * - 补导出上下文和最新 PRD，复制路径变更前的历史产物
 *
 * Notes:
 * - 磁盘同步失败不影响数据库归档；复制与补同步不覆盖不同内容。
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ProductKnowledgeGraphSchema, type LocalStorageEntry, type WorkspaceLocalStorageStatus } from "@repo/shared";
import { getActiveLocalUserWorkspace } from "../repositories/workspace-repository";
import { getProductContextSnapshotByWorkspaceId } from "../repositories/product-context-snapshot-repository";
import { getLatestWorkspacePrdArtifact, type DocumentArtifactDto } from "../repositories/document-generation-repository";
import {
  copyProductContextResourceSnapshot, parseProductContextResourceSnapshot,
  readProductContextResourceSnapshot, retireLegacySnapshot, type ProductContextResourceSnapshot,
} from "./product-context-resource-service";
import {
  assertLocalFileBoundary, copyLocalFile, isMissingLocalFile, localFileId,
  localStorageErrorMessage, readLocalFile, workspaceLocalPaths, writeLocalFile,
} from "./workspace-local-file-service";

/** 本地文件检查所需的工作区身份与根目录。 */
export interface LocalStorageWorkspace { id: string; localPath: string | null }
/** 数据库已保存的预期内容，独立于磁盘检查便于验证失败行为。 */
export interface LocalStorageExpectedContent {
  snapshot: ProductContextResourceSnapshot | null;
  artifact: Pick<DocumentArtifactDto, "id" | "markdown"> | null;
  warnings?: string[];
}

/** 获取最新 PRD 的唯一文件路径。 */
export function workspacePrdPath(localPath: string, workspaceId: string, artifactId: string): string {
  return path.join(workspaceLocalPaths(localPath, workspaceId).prdDirectory, `${localFileId(artifactId)}.md`);
}

/** 识别尚未安装的可选 SQL 表，不掩盖其他数据库错误。 */
function missingTable(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(table) && (message.includes("42P01") || message.includes("does not exist") || message.includes("不存在"));
}

/** 加载数据库预期内容，旧快照仅在未退役时作为兼容来源。 */
async function loadExpectedContent(workspace: LocalStorageWorkspace): Promise<LocalStorageExpectedContent> {
  let snapshot: ProductContextResourceSnapshot | null = null;
  const warnings: string[] = [];
  try {
    const row = await getProductContextSnapshotByWorkspaceId(workspace.id);
    const context = row?.context as { knowledgeGraph?: unknown } | null;
    const result = ProductKnowledgeGraphSchema.safeParse(context?.knowledgeGraph ?? context);
    if (row && result.success) {
      snapshot = {
        version: 1,
        workspaceId: workspace.id,
        updatedAt: row.updatedAt,
        ...(row.conversationId ? { conversationId: row.conversationId } : {}),
        ...(row.requestFormId ? { requestFormId: row.requestFormId } : {}),
        knowledgeGraph: result.data,
      };
    }
  } catch (error) {
    if (!missingTable(error, "product_context_snapshot")) throw error;
    warnings.push("未配置数据库上下文快照表，本地上下文的完整恢复仍依赖项目快照文件。");
  }
  if (!snapshot && workspace.localPath) {
    try {
      if (await readLocalFile(workspace.localPath, workspaceLocalPaths(workspace.localPath, workspace.id).retired) === null) {
        snapshot = await readProductContextResourceSnapshot(workspace.id);
      }
    } catch { /* 真实磁盘阻碍由下面的状态检查展示。 */ }
  }
  let artifact: DocumentArtifactDto | null = null;
  try {
    artifact = await getLatestWorkspacePrdArtifact(workspace.id);
  } catch (error) {
    if (!missingTable(error, "document_generation_run") && !missingTable(error, "document_artifact")) throw error;
    warnings.push("文档存储表未配置，无法查询 PRD 本地同步状态。");
  }
  return { snapshot, artifact, warnings };
}

/** 对照当前文件检查单类产物，所有磁盘错误都变成可展示状态。 */
async function inspectEntry(root: string, target: string, expected: string | null, graph = false): Promise<LocalStorageEntry> {
  try {
    const raw = await readLocalFile(root, target);
    if (raw === null) return { path: target, status: expected === null ? "empty" : "missing", ...(expected !== null ? { message: "本地副本尚未保存，请重新同步。" } : {}) };
    if (graph) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { path: target, status: "conflict", message: "上下文文件已损坏，请保留或移开后重新同步。" }; }
      const value = parsed as ProductContextResourceSnapshot;
      const valid = parseProductContextResourceSnapshot(value, path.basename(target, ".json"));
      if (valid && (expected === null || isDeepStrictEqual(valid.knowledgeGraph, JSON.parse(expected)))) return { path: target, status: "synced" };
    } else if (raw === expected) return { path: target, status: "synced" };
    return { path: target, status: "conflict", message: "本地内容与已保存数据不同，请保留或移开文件后重新同步。" };
  } catch (error) {
    return { path: target, status: "unavailable", message: localStorageErrorMessage(error) };
  }
}

/** 计算当前磁盘状态，不以进程内缓存作为同步成功依据。 */
export async function inspectWorkspaceLocalStorage(workspace: LocalStorageWorkspace, expected: LocalStorageExpectedContent): Promise<WorkspaceLocalStorageStatus> {
  if (!workspace.localPath) {
    const entry: LocalStorageEntry = { path: null, status: "unavailable", message: "项目未关联本地目录。" };
    return { workspaceId: workspace.id, context: entry, prd: entry, warnings: expected.warnings ?? [] };
  }
  const paths = workspaceLocalPaths(workspace.localPath, workspace.id);
  const [context, prd] = await Promise.all([
    inspectEntry(workspace.localPath, paths.context, expected.snapshot ? JSON.stringify(expected.snapshot.knowledgeGraph) : null, true),
    expected.artifact
      ? inspectEntry(workspace.localPath, workspacePrdPath(workspace.localPath, workspace.id, expected.artifact.id), expected.artifact.markdown)
      : Promise.resolve<LocalStorageEntry>({ path: paths.prdDirectory, status: "empty" }),
  ]);
  return { workspaceId: workspace.id, context, prd, warnings: expected.warnings ?? [] };
}

/** 查询工作区已保存内容与本地副本的一致性。 */
export async function getWorkspaceLocalStorageStatus(workspace: LocalStorageWorkspace): Promise<WorkspaceLocalStorageStatus> {
  return inspectWorkspaceLocalStorage(workspace, await loadExpectedContent(workspace));
}

/** 无覆盖补同步上下文和最新 PRD，分别尝试以保留部分成功。 */
export async function synchronizeWorkspaceLocalContent(workspace: LocalStorageWorkspace, expected: LocalStorageExpectedContent): Promise<WorkspaceLocalStorageStatus> {
  const warnings = [...(expected.warnings ?? [])];
  const root = workspace.localPath;
  if (root) {
    const operations = [
      {
        label: "上下文",
        run: async () => { if (expected.snapshot) await copyProductContextResourceSnapshot(root, expected.snapshot); },
      },
      {
        label: "PRD",
        run: async () => { if (expected.artifact) await copyLocalFile(root, workspacePrdPath(root, workspace.id, expected.artifact.id), expected.artifact.markdown); },
      },
    ];
    for (const operation of operations) {
      try { await operation.run(); }
      catch (error) { warnings.push(`${operation.label}：${localStorageErrorMessage(error)}`); }
    }
  }
  return inspectWorkspaceLocalStorage(workspace, { ...expected, warnings });
}

/** 从数据库补导出最新内容，保留现有不同内容供用户处理。 */
export async function synchronizeWorkspaceLocalStorage(workspace: LocalStorageWorkspace): Promise<WorkspaceLocalStorageStatus> {
  return synchronizeWorkspaceLocalContent(workspace, await loadExpectedContent(workspace));
}

/** 数据库归档完成后的 PRD 自动导出，失败不反转已完成的文档任务。 */
export async function exportWorkspacePrd(workspaceId: string, artifact: Pick<DocumentArtifactDto, "id" | "markdown">): Promise<void> {
  try {
    const workspace = await getActiveLocalUserWorkspace(workspaceId);
    if (!workspace?.localPath) return;
    await writeLocalFile(workspace.localPath, workspacePrdPath(workspace.localPath, workspaceId, artifact.id), artifact.markdown);
  } catch (error) {
    console.warn("[document-generation] Local PRD export failed:", localStorageErrorMessage(error));
  }
}

/** 复制本工作区的快照、退役标记和历史 PRD，逐项收集阻碍。 */
export async function copyWorkspaceLocalResources(workspaceId: string, sourceRoot: string, targetRoot: string): Promise<string[]> {
  if (sourceRoot === targetRoot) return [];
  const warnings: string[] = [];
  const source = workspaceLocalPaths(sourceRoot, workspaceId);
  try {
    const snapshot = await readProductContextResourceSnapshot(workspaceId, sourceRoot);
    if (snapshot) await copyProductContextResourceSnapshot(targetRoot, snapshot);
    if (await readLocalFile(sourceRoot, source.retired) !== null) await retireLegacySnapshot(targetRoot, workspaceId);
  } catch (error) { warnings.push(`上下文：${localStorageErrorMessage(error)}`); }
  try {
    await assertLocalFileBoundary(sourceRoot, source.prdDirectory);
    const entries = await readdir(source.prdDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.md$/.test(entry.name)) continue;
      try {
        const content = await readLocalFile(sourceRoot, path.join(source.prdDirectory, entry.name));
        if (content !== null) await copyLocalFile(targetRoot, path.join(workspaceLocalPaths(targetRoot, workspaceId).prdDirectory, entry.name), content);
      } catch (error) { warnings.push(`PRD ${entry.name}：${localStorageErrorMessage(error)}`); }
    }
  } catch (error) { if (!isMissingLocalFile(error)) warnings.push(`PRD 历史：${localStorageErrorMessage(error)}`); }
  return [...new Set(warnings)];
}

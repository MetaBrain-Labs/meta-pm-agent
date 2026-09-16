/**
 * 工作区本地上下文与 PRD 同步测试
 *
 * Responsibilities:
 * - 验证真实文件系统上的隔离、复制、退役、冲突和失败状态
 * - 验证 HTTP 所有权、运行态保护和数据库先归档行为
 *
 * Notes:
 * - 数据库调用使用替身，不调用真实模型；所有产物位于独立临时目录。
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@repo/database";
import { ProductKnowledgeGraphSchema, WorkspaceLocalStorageStatusSchema, type DocumentGenerationResult } from "@repo/shared";
import { createApp } from "../src/app";
import { registerChatRun, unregisterChatRun } from "../src/services/chat-run-registry";
import { saveGeneratedDocument } from "../src/services/document-generation-service";
import {
  clearProductContextResourceSnapshot, readProductContextResourceSnapshot,
  writeProductContextResourceSnapshot, type ProductContextResourceSnapshot,
} from "../src/services/product-context-resource-service";
import { loadProductRuntimeContextForConversation } from "../src/services/product-context-service";
import { finalizeWorkspaceKnowledgeGraph } from "../src/services/product-knowledge-graph-service";
import { updateWorkspace } from "../src/services/workspace-service";
import {
  copyLocalFile, localStorageErrorMessage, readLocalFile, workspaceLocalPaths, writeLocalFile,
} from "../src/services/workspace-local-file-service";
import {
  copyWorkspaceLocalResources, getWorkspaceLocalStorageStatus, inspectWorkspaceLocalStorage,
  synchronizeWorkspaceLocalContent, workspacePrdPath,
} from "../src/services/workspace-local-storage-service";

/** 创建独立测试目录，并在递归清理之前验证绝对目标位于系统临时目录。 */
async function temporaryRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "meta-pm-local-storage-"));
  t.after(async () => {
    const resolved = path.resolve(root);
    const relative = path.relative(path.resolve(tmpdir()), resolved);
    assert.ok(!path.isAbsolute(relative) && !relative.startsWith("..") && path.basename(resolved).startsWith("meta-pm-local-storage-"));
    await rm(resolved, { recursive: true, force: true });
  });
  return root;
}

/** 构造可被共享 Schema 校验的精简运行时上下文。 */
function snapshot(workspaceId = "workspace-a", description = "Saved context"): ProductContextResourceSnapshot {
  return {
    version: 1, workspaceId, updatedAt: "2026-09-16T00:00:00.000Z",
    knowledgeGraph: ProductKnowledgeGraphSchema.parse({
      entities: [], relations: [], decisions: [], risks: [], open_questions: [],
      summary: [], markdown: "", notes: [], current_state: "stable", description,
    }),
  };
}

/** 限定旧快照目录，测试结束恢复环境变量。 */
async function legacyDirectory(t: TestContext): Promise<string> {
  const root = await temporaryRoot(t);
  const previous = process.env.PRODUCT_CONTEXT_RESOURCE_DIR;
  process.env.PRODUCT_CONTEXT_RESOURCE_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PRODUCT_CONTEXT_RESOURCE_DIR;
    else process.env.PRODUCT_CONTEXT_RESOURCE_DIR = previous;
  });
  return root;
}

/** 构造查询工作区的数据库行。 */
function workspaceRow(root: string, id = "workspace-a") {
  return { id, name: "Project", local_path: root, storage_type: "local", cloud_path: null, sync_status: "idle", status: "active", deleted_at: null, created_at: new Date(), updated_at: new Date() };
}

/** 使用显式替身绕过 Prisma 代理的虚拟属性描述符，结束后恢复原方法。 */
function mockPrismaMethod(t: TestContext, method: "$queryRaw" | "$transaction" | "$executeRaw", implementation: unknown): void {
  const original = prisma[method];
  Object.assign(prisma, { [method]: implementation });
  t.after(() => { Object.assign(prisma, { [method]: original }); });
}

/** 验证项目根目录优先，环境变量只定位集中目录，写入不会留下临时文件。 */
test("stores isolated atomic snapshots under project roots instead of the legacy override", async (t) => {
  const legacy = await legacyDirectory(t);
  const project = await temporaryRoot(t);
  for (const id of ["workspace-a", "workspace-b"]) {
    await writeProductContextResourceSnapshot({ workspaceId: id, localPath: project, knowledgeGraph: snapshot(id).knowledgeGraph });
    assert.equal((await readProductContextResourceSnapshot(id, project))?.workspaceId, id);
  }
  const files = await readdir(path.dirname(workspaceLocalPaths(project, "workspace-a").context));
  assert.ok(files.includes(".gitignore") && files.includes("workspace-a.json") && files.includes("workspace-b.json"));
  assert.ok(files.every((file) => !file.endsWith(".tmp")));
  assert.deepEqual(await readdir(legacy), []);
  await assert.rejects(writeLocalFile(project, path.join(project, "..", "escape.json"), "private"));
  assert.equal((await readProductContextResourceSnapshot("../escape", project)), null);
});

/** 验证旧快照惰性复制、原文件保留，清空后退役标记阻止旧副本复活。 */
test("copies legacy snapshots once and never resurrects them after clearing", async (t) => {
  const legacy = await legacyDirectory(t);
  const project = await temporaryRoot(t);
  await writeProductContextResourceSnapshot({ workspaceId: "workspace-a", knowledgeGraph: snapshot().knowledgeGraph });
  assert.equal((await readProductContextResourceSnapshot("workspace-a", project))?.knowledgeGraph.current_state, "stable");
  assert.ok(await readFile(path.join(legacy, "workspace-a.json"), "utf8"));
  await clearProductContextResourceSnapshot("workspace-a", project);
  assert.equal(await readProductContextResourceSnapshot("workspace-a", project), null);
  assert.ok(await readFile(path.join(legacy, "workspace-a.json"), "utf8"));
  assert.equal(await readLocalFile(project, workspaceLocalPaths(project, "workspace-a").retired), "1\n");
});

/** 损坏、工作区不匹配和未知版本的本地文件不能降级到旧集中副本。 */
test("rejects corrupt and incompatible project snapshots without loading stale legacy data", async (t) => {
  await legacyDirectory(t);
  const project = await temporaryRoot(t);
  await writeProductContextResourceSnapshot({ workspaceId: "workspace-a", knowledgeGraph: snapshot().knowledgeGraph });
  for (const raw of ["{broken", JSON.stringify(snapshot("workspace-b")), JSON.stringify({ ...snapshot(), version: 2 })]) {
    await writeLocalFile(project, workspaceLocalPaths(project, "workspace-a").context, raw);
    assert.equal(await readProductContextResourceSnapshot("workspace-a", project), null);
  }
});

/** 快照在本地落盘失败后，恢复使用数据库新上下文并保留数据库图谱。 */
test("restores newer database context instead of a stale local copy", async (t) => {
  const project = await temporaryRoot(t);
  await writeProductContextResourceSnapshot({ workspaceId: "workspace-a", localPath: project, knowledgeGraph: snapshot().knowledgeGraph });
  await writeFile(path.join(project, "README.md"), "Project overview");
  mockPrismaMethod(t, "$queryRaw", async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "conversation"')) return [{ workspace_id: "workspace-a", workspace_name: "Project", local_path: project }];
    if (sql.includes('FROM "product_context_snapshot"')) return [{ context_json: { knowledgeGraph: snapshot("workspace-a", "Newest database context").knowledgeGraph }, version: 2, updated_at: new Date() }];
    if (sql.includes('FROM "product_knowledge_graph"')) return [{ nodes: [{ id: "goal-a", type: "Goal", name: "Goal" }], relations: [] }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const context = await loadProductRuntimeContextForConversation("conversation-a");
  assert.equal(context.contextSource, "database");
  assert.equal(context.knowledgeGraph?.description, "Newest database context");
  assert.equal(context.knowledgeGraph?.entities[0]?.id, "goal-a");
  assert.ok(context.productContext.includes("Project overview"));
});

/** 无覆盖同步保留 PRD 历史，磁盘变化可由新状态查询发现。 */
test("synchronizes latest artifacts and detects missing and conflicting files after reload", async (t) => {
  const project = await temporaryRoot(t);
  const workspace = { id: "workspace-a", localPath: project };
  const expected = { snapshot: snapshot(), artifact: { id: "artifact-a", markdown: "# PRD A" } };
  const missing = await inspectWorkspaceLocalStorage(workspace, expected);
  assert.equal(missing.context.status, "missing");
  assert.equal(missing.prd.status, "missing");
  assert.ok(WorkspaceLocalStorageStatusSchema.safeParse(missing).success);
  const synced = await synchronizeWorkspaceLocalContent(workspace, expected);
  assert.equal(synced.context.status, "synced");
  assert.equal(synced.prd.status, "synced");
  await synchronizeWorkspaceLocalContent(workspace, { ...expected, artifact: { id: "artifact-b", markdown: "# PRD B" } });
  assert.equal(await readFile(workspacePrdPath(project, workspace.id, "artifact-a"), "utf8"), "# PRD A");
  await writeLocalFile(project, workspacePrdPath(project, workspace.id, "artifact-a"), "User changes");
  const conflict = await synchronizeWorkspaceLocalContent(workspace, expected);
  assert.equal(conflict.prd.status, "conflict");
  assert.ok(conflict.warnings.length > 0);
  assert.equal(await readFile(workspacePrdPath(project, workspace.id, "artifact-a"), "utf8"), "User changes");
  await rm(workspacePrdPath(project, workspace.id, "artifact-a"));
  assert.equal((await inspectWorkspaceLocalStorage(workspace, expected)).prd.status, "missing");
  assert.equal((await synchronizeWorkspaceLocalContent(workspace, expected)).prd.status, "synced");
});

/** 分项复制保留源文件，不复制其他工作区，不同内容冲突不阻断其余产物。 */
test("copies only workspace resources and retains originals with partial conflict warnings", async (t) => {
  const source = await temporaryRoot(t);
  const target = await temporaryRoot(t);
  await synchronizeWorkspaceLocalContent({ id: "workspace-a", localPath: source }, { snapshot: snapshot(), artifact: { id: "artifact-a", markdown: "A" } });
  await writeLocalFile(source, workspacePrdPath(source, "workspace-a", "artifact-b"), "B");
  await writeLocalFile(source, workspacePrdPath(source, "workspace-b", "other"), "Other workspace");
  await writeLocalFile(target, workspacePrdPath(target, "workspace-a", "artifact-a"), "Target changes");
  const warnings = await copyWorkspaceLocalResources("workspace-a", source, target);
  assert.equal(warnings.length, 1);
  assert.equal(await readFile(workspacePrdPath(target, "workspace-a", "artifact-a"), "utf8"), "Target changes");
  assert.equal(await readFile(workspacePrdPath(target, "workspace-a", "artifact-b"), "utf8"), "B");
  assert.equal(await readFile(workspacePrdPath(source, "workspace-a", "artifact-a"), "utf8"), "A");
  assert.equal(await readLocalFile(target, workspacePrdPath(target, "workspace-b", "other")), null);
  assert.equal((await readProductContextResourceSnapshot("workspace-a", target))?.workspaceId, "workspace-a");
});

/** 无覆盖发布在并发写入下仍保护先到的不同内容。 */
test("does not overwrite an existing file during concurrent copies or change ignore rules", async (t) => {
  const root = await temporaryRoot(t);
  const target = workspacePrdPath(root, "workspace-a", "artifact-a");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(path.join(path.dirname(target), ".gitignore"), "custom rule\n");
  const results = await Promise.allSettled([copyLocalFile(root, target, "A"), copyLocalFile(root, target, "B")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(["A", "B"].includes(await readFile(target, "utf8")));
  assert.equal(await readFile(path.join(path.dirname(target), ".gitignore"), "utf8"), "custom rule\n");
  assert.ok((await readdir(path.dirname(target))).every((file) => !file.endsWith(".tmp")));
});

/** 无法创建生成目录时分别返回阻碍状态，权限和空间错误保持简短可操作。 */
test("reports disk failures without throwing away partial synchronization status", async (t) => {
  const root = await temporaryRoot(t);
  await writeFile(path.join(root, "resources"), "Blocking file");
  const status = await synchronizeWorkspaceLocalContent({ id: "workspace-a", localPath: root }, { snapshot: snapshot(), artifact: { id: "artifact-a", markdown: "PRD" } });
  assert.equal(status.context.status, "unavailable");
  assert.equal(status.prd.status, "unavailable");
  assert.equal(status.warnings.length, 2);
  assert.ok(localStorageErrorMessage({ code: "EROFS" }).includes("权限"));
  assert.ok(localStorageErrorMessage({ code: "EACCES" }).includes("权限"));
  assert.ok(localStorageErrorMessage({ code: "ENOSPC" }).includes("空间"));
});

/** 模拟只读磁盘真实 I/O 错误，确认补同步返回提示且原子写入不留下临时文件。 */
test("handles read-only filesystem errors while retaining database-backed status", async (t) => {
  const root = await temporaryRoot(t);
  const original = fsPromises.writeFile;
  fsPromises.writeFile = async () => { throw Object.assign(new Error("Read-only filesystem"), { code: "EROFS" }); };
  syncBuiltinESMExports();
  t.after(() => { fsPromises.writeFile = original; syncBuiltinESMExports(); });
  const status = await synchronizeWorkspaceLocalContent({ id: "workspace-a", localPath: root }, { snapshot: snapshot(), artifact: { id: "artifact-a", markdown: "PRD saved in database" } });
  assert.equal(status.context.status, "missing");
  assert.equal(status.prd.status, "missing");
  assert.ok(status.warnings.every((message) => message.includes("权限")));
  for (const directory of [path.dirname(workspaceLocalPaths(root, "workspace-a").context), workspaceLocalPaths(root, "workspace-a").prdDirectory]) {
    assert.ok((await readdir(directory)).every((file) => !file.endsWith(".tmp")));
  }
});

/** 拒绝目录链接，包括指向目录外的链接，不读写链接目标。 */
test("rejects linked artifact directories without modifying the linked target", async (t) => {
  const root = await temporaryRoot(t);
  const outside = await temporaryRoot(t);
  await symlink(outside, path.join(root, "resources"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(writeLocalFile(root, workspaceLocalPaths(root, "workspace-a").context, "private"));
  assert.deepEqual(await readdir(outside), []);
});

/** 文档最终保存的状态不受本地导出错误影响，同一产物更新时使用相同路径。 */
test("keeps completed and awaiting-input documents persisted when local export fails", async (t) => {
  const root = await temporaryRoot(t);
  await writeFile(path.join(root, "resources"), "Blocking file");
  const statuses: string[] = [];
  mockPrismaMethod(t, "$queryRaw", async () => [workspaceRow(root)]);
  mockPrismaMethod(t, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $queryRaw: async () => [{ id: "artifact-a", workspace_id: "workspace-a", run_id: "run-a", kind: "prd", title: "PRD", content_markdown: "# PRD", content_json: null, version: 1, created_at: new Date(), updated_at: new Date() }],
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => { statuses.push(String(values[0])); return 1; },
  }));
  t.mock.method(console, "warn", () => {});
  for (const status of ["completed", "awaiting_input"] as const) {
    const result = { title: "PRD", markdown: "# PRD", qualityScore: { attempts: [] } } as unknown as DocumentGenerationResult;
    const artifact = await saveGeneratedDocument({ runId: "run-a", workspaceId: "workspace-a", kind: "prd", result, todos: [], status });
    assert.equal(artifact.markdown, "# PRD");
  }
  assert.deepEqual(statuses, ["completed", "awaiting_input"]);
});

/** Executor 中间归档和最终归档都在磁盘失败后保存数据库，并保留版本推进标志。 */
test("archives graph and context in the database when local snapshot writes fail", async (t) => {
  const root = await temporaryRoot(t);
  await writeFile(path.join(root, "resources"), "Blocking file");
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  mockPrismaMethod(t, "$queryRaw", async () => [workspaceRow(root)]);
  mockPrismaMethod(t, "$executeRaw", async (strings: TemplateStringsArray, ...values: unknown[]) => {
    writes.push({ sql: strings.join("?"), values });
    return 1;
  });
  t.mock.method(console, "warn", () => {});
  const knowledgeGraph = ProductKnowledgeGraphSchema.parse({ ...snapshot().knowledgeGraph, entities: [{ id: "goal-a", type: "Goal", name: "Goal" }] });
  for (const advanceVersion of [false, true]) {
    await finalizeWorkspaceKnowledgeGraph({ workspaceId: "workspace-a", conversationId: "conversation-a", requestFormId: "request-a", knowledgeGraph, advanceVersion });
  }
  assert.equal(writes.filter((write) => write.sql.includes('INSERT INTO "product_context_snapshot"')).length, 2);
  const graphWrites = writes.filter((write) => write.sql.includes('INSERT INTO "product_knowledge_graph"'));
  assert.equal(graphWrites.length, 2);
  assert.ok(graphWrites[0].values.includes(false));
  assert.ok(graphWrites[1].values.includes(true));
});

/** 查询与补同步路由验证所有权、实时文件状态和活跃聊天的保护。 */
test("serves live local-storage status and protects synchronization by ownership and active runs", async (t) => {
  const root = await temporaryRoot(t);
  const app = createApp();
  let activeDocument = false;
  mockPrismaMethod(t, "$queryRaw", async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "conversation"')) return [{ id: "conversation-a", created_at: new Date(), last_message_at: null }];
    if (sql.includes('FROM "workspace"')) return values[0] === "workspace-a" ? [workspaceRow(root)] : [];
    if (sql.includes('FROM "product_context_snapshot"')) return [{ context_json: { knowledgeGraph: snapshot().knowledgeGraph }, version: 1, updated_at: new Date() }];
    if (sql.includes('FROM "document_generation_run"')) return activeDocument ? [{ id: "document-run-a", status: "running", created_at: new Date(), updated_at: new Date(), started_at: null, finished_at: null }] : [];
    if (sql.includes('FROM "document_artifact"')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const response = await app.request("/api/workspaces/workspace-a/local-storage");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).context.status, "missing");
  assert.equal((await app.request("/api/workspaces/other-workspace/local-storage")).status, 404);
  assert.equal((await app.request("/api/workspaces/other-workspace/local-storage/sync", { method: "POST" })).status, 404);
  const controller = new AbortController();
  registerChatRun("conversation-a", controller);
  try {
    assert.equal((await app.request("/api/workspaces/workspace-a/local-storage/sync", { method: "POST" })).status, 409);
    assert.equal((await app.request("/api/workspaces/workspace-a", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localPath: root }) })).status, 409);
  } finally { unregisterChatRun("conversation-a", controller); }
  activeDocument = true;
  assert.equal((await app.request("/api/workspaces/workspace-a/local-storage/sync", { method: "POST" })).status, 409);
  assert.equal((await app.request("/api/workspaces/workspace-a", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localPath: root }) })).status, 409);
  activeDocument = false;
  const synced = await app.request("/api/workspaces/workspace-a/local-storage/sync", { method: "POST" });
  assert.equal(synced.status, 200);
  assert.equal((await synced.json()).context.status, "synced");
  await rm(workspaceLocalPaths(root, "workspace-a").context);
  assert.equal((await getWorkspaceLocalStorageStatus({ id: "workspace-a", localPath: root })).context.status, "missing");
});

/** 自动导出沿用产物 ID，更新同一产物并保留其他产物的 Markdown。 */
test("automatically exports document revisions with stable artifact paths and preserved history", async (t) => {
  const root = await temporaryRoot(t);
  let artifactId = "artifact-a";
  let markdown = "# Initial PRD";
  mockPrismaMethod(t, "$queryRaw", async () => [workspaceRow(root)]);
  mockPrismaMethod(t, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $queryRaw: async () => [{ id: artifactId, workspace_id: "workspace-a", run_id: "run-a", kind: "prd", title: "PRD", content_markdown: markdown, content_json: null, version: 1, created_at: new Date(), updated_at: new Date() }],
    $executeRaw: async () => 1,
  }));
  for (const status of ["awaiting_input", "completed"] as const) {
    markdown = status === "awaiting_input" ? "# Initial PRD" : "# Revised PRD";
    const result = { title: "PRD", markdown, qualityScore: { attempts: [] } } as unknown as DocumentGenerationResult;
    await saveGeneratedDocument({ runId: "run-a", workspaceId: "workspace-a", kind: "prd", result, todos: [], status });
    assert.equal(await readFile(workspacePrdPath(root, "workspace-a", artifactId), "utf8"), markdown);
  }
  artifactId = "artifact-b";
  markdown = "# Next PRD";
  await saveGeneratedDocument({ runId: "run-b", workspaceId: "workspace-a", kind: "prd", result: { title: "PRD", markdown, qualityScore: { attempts: [] } } as unknown as DocumentGenerationResult, todos: [] });
  assert.equal(await readFile(workspacePrdPath(root, "workspace-a", "artifact-a"), "utf8"), "# Revised PRD");
  assert.equal(await readFile(workspacePrdPath(root, "workspace-a", "artifact-b"), "utf8"), "# Next PRD");
});

/** 路径已保存时复制失败只返回提示，原目录与设置不能被撤销。 */
test("updates the local path even when copying generated files fails", async (t) => {
  const source = await temporaryRoot(t);
  const target = await temporaryRoot(t);
  const targetReal = await realpath(target);
  await synchronizeWorkspaceLocalContent({ id: "workspace-a", localPath: source }, { snapshot: snapshot(), artifact: null });
  await writeFile(path.join(target, "resources"), "Blocking file");
  let updated = false;
  mockPrismaMethod(t, "$queryRaw", async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('UPDATE "workspace"')) { updated = true; return [workspaceRow(targetReal)]; }
    if (sql.includes('FROM "workspace"')) return sql.includes('"local_path" =') ? [] : [workspaceRow(source)];
    if (sql.includes('FROM "conversation"') || sql.includes('FROM "document_generation_run"') || sql.includes('FROM "document_artifact"')) return [];
    if (sql.includes('FROM "product_context_snapshot"')) return [{ context_json: { knowledgeGraph: snapshot().knowledgeGraph }, version: 1, updated_at: new Date() }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const result = await updateWorkspace("workspace-a", { localPath: target });
  assert.ok(updated);
  assert.equal(result.localPath, targetReal);
  assert.ok("localStorageWarnings" in result && result.localStorageWarnings.length > 0);
  assert.ok(await readFile(workspaceLocalPaths(source, "workspace-a").context, "utf8"));
});

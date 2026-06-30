/**
 * 文档生成持久化仓库
 *
 * 使用 raw SQL 访问 document_generation_run 与 document_artifact 表，记录后台
 * 文档生成任务状态和最终文档产物。由于用户会手动建表，这里不依赖 Prisma model。
 *
 * Responsibilities:
 * - 创建、查询和更新文档生成 run
 * - 保存生成完成的文档 artifact
 * - 查询当前工作区指定文档类型的最新 run
 *
 * Notes:
 * - 表结构 SQL 由 docs/database/document-generation.sql 提供。
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type {
  DocumentGenerationResult,
  DocumentGenerationStatus,
  DocumentKind,
  DocumentReasoningLogEntry,
  DocumentScoreAttempt,
  DocumentTodo,
  DocumentWorkflowStage,
} from "@repo/shared";

/**
 * 文档生成 run 的数据库行。
 */
interface DocumentGenerationRunRow {
  id: string;
  workspace_id: string;
  kind: DocumentKind;
  status: DocumentGenerationStatus;
  workflow_thread_id: string;
  current_stage: DocumentWorkflowStage | null;
  task_planning: unknown;
  reasoning_log: unknown;
  scoring_attempts: unknown;
  document_artifact_id: string | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 文档 artifact 的数据库行。
 */
interface DocumentArtifactRow {
  id: string;
  workspace_id: string;
  run_id: string;
  kind: DocumentKind;
  title: string;
  content_markdown: string;
  content_json: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * 前端/API 使用的文档生成 run DTO。
 */
export interface DocumentGenerationRunDto {
  id: string;
  workspaceId: string;
  kind: DocumentKind;
  status: DocumentGenerationStatus;
  workflowThreadId: string;
  currentStage: DocumentWorkflowStage | null;
  todos: DocumentTodo[];
  reasoningLog: DocumentReasoningLogEntry[];
  scoringAttempts: DocumentScoreAttempt[];
  documentArtifactId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 前端/API 使用的文档 artifact DTO。
 */
export interface DocumentArtifactDto {
  id: string;
  workspaceId: string;
  runId: string;
  kind: DocumentKind;
  title: string;
  markdown: string;
  content: DocumentGenerationResult | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建一条文档生成 run。
 */
export async function createDocumentGenerationRun({
  runId,
  workspaceId,
  kind,
  workflowThreadId,
}: {
  runId?: string;
  workspaceId: string;
  kind: DocumentKind;
  workflowThreadId: string;
}): Promise<DocumentGenerationRunDto> {
  const rows = await prisma.$queryRaw<DocumentGenerationRunRow[]>`
    INSERT INTO "document_generation_run" (
      "id",
      "workspace_id",
      "kind",
      "status",
      "workflow_thread_id",
      "task_planning",
      "reasoning_log",
      "scoring_attempts"
    )
    VALUES (
      ${runId ?? randomUUID()},
      ${workspaceId},
      ${kind},
      'queued',
      ${workflowThreadId},
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
    RETURNING *
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create document generation run.");
  }

  return mapRunRow(row);
}

/**
 * 查询指定工作区和文档类型的运行中任务。
 */
export async function getActiveDocumentGenerationRun(
  workspaceId: string,
  kind: DocumentKind,
): Promise<DocumentGenerationRunDto | null> {
  const rows = await prisma.$queryRaw<DocumentGenerationRunRow[]>`
    SELECT *
    FROM "document_generation_run"
    WHERE "workspace_id" = ${workspaceId}
      AND "kind" = ${kind}
      AND "status" IN ('queued', 'running')
    ORDER BY "created_at" DESC
    LIMIT 1
  `;

  return rows[0] ? mapRunRow(rows[0]) : null;
}

/**
 * 查询工作区指定文档类型的最新 run。
 */
export async function getLatestDocumentGenerationRun(
  workspaceId: string,
  kind: DocumentKind,
): Promise<DocumentGenerationRunDto | null> {
  const rows = await prisma.$queryRaw<DocumentGenerationRunRow[]>`
    SELECT *
    FROM "document_generation_run"
    WHERE "workspace_id" = ${workspaceId}
      AND "kind" = ${kind}
    ORDER BY "created_at" DESC
    LIMIT 1
  `;

  return rows[0] ? mapRunRow(rows[0]) : null;
}

/**
 * 按 ID 查询文档生成 run。
 */
export async function getDocumentGenerationRunById(
  runId: string,
): Promise<DocumentGenerationRunDto | null> {
  const rows = await prisma.$queryRaw<DocumentGenerationRunRow[]>`
    SELECT *
    FROM "document_generation_run"
    WHERE "id" = ${runId}
    LIMIT 1
  `;

  return rows[0] ? mapRunRow(rows[0]) : null;
}

/**
 * 查询指定 run 的文档 artifact。
 */
export async function getDocumentArtifactByRunId(
  runId: string,
): Promise<DocumentArtifactDto | null> {
  const rows = await prisma.$queryRaw<DocumentArtifactRow[]>`
    SELECT *
    FROM "document_artifact"
    WHERE "run_id" = ${runId}
    LIMIT 1
  `;

  return rows[0] ? mapArtifactRow(rows[0]) : null;
}

/**
 * 将 run 标记为运行中，并写入当前阶段。
 */
export async function markDocumentGenerationRunRunning({
  runId,
  currentStage,
}: {
  runId: string;
  currentStage?: DocumentWorkflowStage | null;
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "document_generation_run"
    SET
      "status" = 'running',
      "current_stage" = ${currentStage ?? null},
      "started_at" = COALESCE("started_at", CURRENT_TIMESTAMP),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${runId}
      AND "status" IN ('queued', 'running')
  `;
}

/**
 * 更新 run 的阶段和 Task planning。
 */
export async function updateDocumentGenerationRunProgress({
  runId,
  currentStage,
  todos,
  reasoningLog,
  scoringAttempts,
}: {
  runId: string;
  currentStage?: DocumentWorkflowStage | null;
  todos?: DocumentTodo[];
  reasoningLog?: DocumentReasoningLogEntry[];
  scoringAttempts?: DocumentScoreAttempt[];
}): Promise<void> {
  const todosJson = todos ? JSON.stringify(todos) : undefined;
  const reasoningJson = reasoningLog ? JSON.stringify(reasoningLog) : undefined;
  const scoringJson = scoringAttempts ? JSON.stringify(scoringAttempts) : undefined;

  await prisma.$executeRaw`
    UPDATE "document_generation_run"
    SET
      "current_stage" = COALESCE(${currentStage ?? null}, "current_stage"),
      "task_planning" = COALESCE(${todosJson ?? null}::jsonb, "task_planning"),
      "reasoning_log" = COALESCE(${reasoningJson ?? null}::jsonb, "reasoning_log"),
      "scoring_attempts" = COALESCE(${scoringJson ?? null}::jsonb, "scoring_attempts"),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${runId}
      AND "status" IN ('queued', 'running')
  `;
}

/**
 * 保存最终文档并完成 run。
 */
export async function completeDocumentGenerationRun({
  runId,
  workspaceId,
  kind,
  result,
  todos,
}: {
  runId: string;
  workspaceId: string;
  kind: DocumentKind;
  result: DocumentGenerationResult;
  todos: DocumentTodo[];
}): Promise<DocumentArtifactDto> {
  const artifact = await prisma.$transaction(async (tx) => {
    const contentJson = JSON.stringify(result);
    const artifacts = await tx.$queryRaw<DocumentArtifactRow[]>`
      INSERT INTO "document_artifact" (
        "id",
        "workspace_id",
        "run_id",
        "kind",
        "title",
        "content_markdown",
        "content_json",
        "version"
      )
      VALUES (
        ${randomUUID()},
        ${workspaceId},
        ${runId},
        ${kind},
        ${result.title},
        ${result.markdown},
        ${contentJson}::jsonb,
        COALESCE((
          SELECT MAX("version") + 1
          FROM "document_artifact"
          WHERE "workspace_id" = ${workspaceId}
            AND "kind" = ${kind}
        ), 1)
      )
      ON CONFLICT ("run_id") DO UPDATE
      SET
        "title" = EXCLUDED."title",
        "content_markdown" = EXCLUDED."content_markdown",
        "content_json" = EXCLUDED."content_json",
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const artifact = artifacts[0];
    if (!artifact) {
      throw new Error("Failed to persist generated document.");
    }

    await tx.$executeRaw`
      UPDATE "document_generation_run"
      SET
        "status" = 'completed',
        "current_stage" = 'exportPrd',
        "task_planning" = ${JSON.stringify(todos)}::jsonb,
        "scoring_attempts" = ${JSON.stringify(result.qualityScore.attempts)}::jsonb,
        "document_artifact_id" = ${artifact.id},
        "error_message" = NULL,
        "finished_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${runId}
    `;

    return artifact;
  });

  return mapArtifactRow(artifact);
}

/**
 * 标记 run 已被用户手动停止。
 */
export async function stopDocumentGenerationRun(runId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "document_generation_run"
    SET
      "status" = 'stopped',
      "finished_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${runId}
      AND "status" IN ('queued', 'running')
  `;
}

/**
 * 标记 run 失败并保存用户可读错误。
 */
export async function failDocumentGenerationRun({
  runId,
  errorMessage,
}: {
  runId: string;
  errorMessage: string;
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "document_generation_run"
    SET
      "status" = 'failed',
      "error_message" = ${errorMessage},
      "finished_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${runId}
      AND "status" IN ('queued', 'running')
  `;
}

/**
 * 将数据库 run 行映射为 DTO。
 */
function mapRunRow(row: DocumentGenerationRunRow): DocumentGenerationRunDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    status: row.status,
    workflowThreadId: row.workflow_thread_id,
    currentStage: row.current_stage,
    todos: parseJsonColumn(row.task_planning, []),
    reasoningLog: parseJsonColumn(row.reasoning_log, []),
    scoringAttempts: parseJsonColumn(row.scoring_attempts, []),
    documentArtifactId: row.document_artifact_id,
    errorMessage: row.error_message,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * 将数据库 artifact 行映射为 DTO。
 */
function mapArtifactRow(row: DocumentArtifactRow): DocumentArtifactDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    kind: row.kind,
    title: row.title,
    markdown: row.content_markdown,
    content: parseJsonColumn<DocumentGenerationResult | null>(
      row.content_json,
      null,
    ),
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * 安全解析 JSONB 列，兼容驱动已返回对象的情况。
 */
function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return value as T;
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

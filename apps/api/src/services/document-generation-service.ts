/**
 * 文档生成业务服务
 *
 * 负责启动 Document Agent 后台任务、轮询任务状态、手动中断运行以及保存最终
 * 文档产物。运行编排委托给 agent-runtime 的独立 Document LangGraph。
 *
 * Responsibilities:
 * - 启动 PRD 文档生成后台 run
 * - 将 LangGraph 阶段、write_todos 和最终结果同步到数据库
 * - 提供状态查询和用户手动中断能力
 *
 * Notes:
 * - 当前后台执行依赖 API 进程存活；服务不可用时任务会失去运行载体。
 */

import { randomUUID } from "node:crypto";
import {
  createDocumentWorkflowThreadId,
  streamDocumentWorkflow,
} from "@repo/agent-runtime";
import type {
  DocumentGenerationResult,
  DocumentKind,
  DocumentTodo,
  DocumentWorkflowStage,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
} from "@repo/shared";
import {
  completeDocumentGenerationRun,
  createDocumentGenerationRun,
  failDocumentGenerationRun,
  getActiveDocumentGenerationRun,
  getDocumentArtifactByRunId,
  getDocumentGenerationRunById,
  getLatestDocumentGenerationRun,
  markDocumentGenerationRunRunning,
  stopDocumentGenerationRun,
  updateDocumentGenerationRunProgress,
  type DocumentArtifactDto,
  type DocumentGenerationRunDto,
} from "../repositories/document-generation-repository";
import { getWorkspaceKnowledgeGraph } from "./product-knowledge-graph-service";

/**
 * 文档任务状态响应。
 */
export interface DocumentGenerationStatusDto {
  run: DocumentGenerationRunDto | null;
  artifact: DocumentArtifactDto | null;
}

/**
 * 带 HTTP 状态码的业务错误。
 */
export class DocumentGenerationServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const activeDocumentRuns = new Map<string, AbortController>();

/**
 * 启动指定工作区的文档生成任务。
 */
export async function startDocumentGeneration({
  workspaceId,
  kind,
}: {
  workspaceId: string;
  kind: DocumentKind;
}): Promise<DocumentGenerationStatusDto> {
  if (kind !== "prd") {
    throw new DocumentGenerationServiceError("当前仅支持生成 PRD。", 400);
  }

  const existingRun = await getActiveDocumentGenerationRun(workspaceId, kind);
  if (existingRun) {
    return {
      run: existingRun,
      artifact: existingRun.documentArtifactId
        ? await getDocumentArtifactByRunId(existingRun.id)
        : null,
    };
  }

  const graph = await loadDocumentSourceGraph(workspaceId);
  const runId = randomUUID();
  const workflowThreadId = createDocumentWorkflowThreadId({
    workspaceId,
    runId,
    kind,
  });
  const run = await createDocumentGenerationRun({
    runId,
    workspaceId,
    kind,
    workflowThreadId,
  });

  launchDocumentGenerationRun(run, graph);

  return { run, artifact: null };
}

/**
 * 查询工作区指定文档类型的最新任务状态。
 */
export async function getLatestDocumentGenerationStatus({
  workspaceId,
  kind,
}: {
  workspaceId: string;
  kind: DocumentKind;
}): Promise<DocumentGenerationStatusDto> {
  const run = await getLatestDocumentGenerationRun(workspaceId, kind);
  if (!run) return { run: null, artifact: null };

  return {
    run,
    artifact: run.documentArtifactId
      ? await getDocumentArtifactByRunId(run.id)
      : null,
  };
}

/**
 * 按 run ID 查询任务状态。
 */
export async function getDocumentGenerationStatusByRunId(
  runId: string,
): Promise<DocumentGenerationStatusDto> {
  const run = await getDocumentGenerationRunById(runId);
  if (!run) return { run: null, artifact: null };

  return {
    run,
    artifact: run.documentArtifactId
      ? await getDocumentArtifactByRunId(run.id)
      : null,
  };
}

/**
 * 用户手动中断文档生成任务。
 */
export async function stopDocumentGeneration(runId: string): Promise<void> {
  const controller = activeDocumentRuns.get(runId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }

  await stopDocumentGenerationRun(runId);
}

/**
 * 从产品知识图谱服务加载文档生成所需图谱。
 */
async function loadDocumentSourceGraph(workspaceId: string): Promise<{
  nodes: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
}> {
  const graph = await getWorkspaceKnowledgeGraph(workspaceId);
  if (!graph || graph.nodes.length === 0) {
    throw new DocumentGenerationServiceError(
      "当前工作区还没有可用于生成 PRD 的知识图谱。",
      409,
    );
  }

  return {
    nodes: graph.nodes,
    relations: graph.relations,
  };
}

/**
 * 在 API 进程内启动后台文档生成任务。
 */
function launchDocumentGenerationRun(
  run: DocumentGenerationRunDto,
  graph: {
    nodes: KnowledgeGraphEntity[];
    relations: KnowledgeGraphRelation[];
  },
): void {
  const controller = new AbortController();
  activeDocumentRuns.set(run.id, controller);

  void executeDocumentGenerationRun(run, graph, controller).finally(() => {
    if (activeDocumentRuns.get(run.id) === controller) {
      activeDocumentRuns.delete(run.id);
    }
  });
}

/**
 * 执行后台文档生成任务并同步状态。
 */
async function executeDocumentGenerationRun(
  run: DocumentGenerationRunDto,
  graph: {
    nodes: KnowledgeGraphEntity[];
    relations: KnowledgeGraphRelation[];
  },
  controller: AbortController,
): Promise<void> {
  let latestTodos = run.todos;
  let result: DocumentGenerationResult | null = null;

  try {
    await markDocumentGenerationRunRunning({ runId: run.id });
    const stream = streamDocumentWorkflow({
      workspaceId: run.workspaceId,
      runId: run.id,
      kind: run.kind,
      graph,
      workflowThreadId: run.workflowThreadId,
      signal: controller.signal,
    });

    let next = await stream.next();
    while (!next.done) {
      if (controller.signal.aborted) {
        throw createAbortError();
      }

      const event = next.value;
      if (event.type === "document-stage" && event.status === "started") {
        await updateRunStage(run.id, event.stage);
      }
      if (event.type === "todo-update") {
        latestTodos = event.todos;
        await updateDocumentGenerationRunProgress({
          runId: run.id,
          todos: latestTodos,
        });
      }
      if (event.type === "document-complete") {
        result = event.result;
      }

      next = await stream.next();
    }

    result = result ?? next.value.result;
    latestTodos = next.value.todos.length > 0 ? next.value.todos : latestTodos;

    if (controller.signal.aborted) {
      throw createAbortError();
    }

    await completeDocumentGenerationRun({
      runId: run.id,
      workspaceId: run.workspaceId,
      kind: run.kind,
      result,
      todos: latestTodos,
    });
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      await stopDocumentGenerationRun(run.id);
      return;
    }

    console.error("[document-generation] Failed:", error);
    await failDocumentGenerationRun({
      runId: run.id,
      errorMessage: compactErrorMessage(error),
    });
  }
}

/**
 * 同步当前文档工作流阶段。
 */
async function updateRunStage(
  runId: string,
  stage: DocumentWorkflowStage,
): Promise<void> {
  await markDocumentGenerationRunRunning({
    runId,
    currentStage: stage,
  });
}

/**
 * 创建标准 AbortError。
 */
function createAbortError(): Error {
  const error = new Error("Document generation was stopped by the user.");
  error.name = "AbortError";
  return error;
}

/**
 * 判断异常是否为用户主动中断。
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 压缩写入数据库和前端展示的错误信息。
 */
function compactErrorMessage(error: unknown, maxLength = 300): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine =
    message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "文档生成失败。";

  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength).trimEnd()}...`
    : firstLine;
}

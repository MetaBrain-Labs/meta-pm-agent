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
  type DocumentEvidenceBlocker,
  createScoreRetryFeedback,
  createDocumentWorkflowThreadId,
  DOCUMENT_SCORE_MAX_ATTEMPTS,
  streamDocumentWorkflow,
} from "@repo/agent-runtime";
import type {
  DocumentGenerationResult,
  DocumentKind,
  DocumentReasoningLogEntry,
  DocumentScoreAttempt,
  DocumentTodo,
  DocumentWorkflowStage,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  ModelUsageProfile,
} from "@repo/shared";
import {
  completeDocumentGenerationRun,
  createDocumentGenerationRun,
  ensureDocumentArtifactSourceGraphVersion,
  failDocumentGenerationRun,
  getActiveDocumentGenerationRun,
  getDocumentArtifactByRunId,
  getDocumentGenerationRunById,
  getLatestDocumentGenerationRun,
  markDocumentGenerationRunRunning,
  resumeAwaitingDocumentGenerationRun,
  stopDocumentGenerationRun,
  updateDocumentGenerationRunProgress,
  type DocumentArtifactDto,
  type DocumentGenerationRunDto,
} from "../repositories/document-generation-repository";
import {
  getConversationById,
} from "../repositories/chat-repository";
import {
  createDocumentEvidenceResolutionItem,
  findDocumentEvidenceResolutionByRunId,
} from "../repositories/request-form-repository";
import {
  getLocalModelProfile,
  ModelProfileNotFoundError,
  selectConversationModelProfile,
} from "../repositories/model-profile-repository";
import { createChat } from "./chat-service";
import { getWorkspaceKnowledgeGraph } from "./product-knowledge-graph-service";

/**
 * 文档任务状态响应。
 */
export interface DocumentGenerationStatusDto {
  run: DocumentGenerationRunDto | null;
  artifact: DocumentArtifactDto | null;
  evidenceResolution?: {
    status: string;
    sourceGraphVersion: number;
    resolvedGraphVersion?: number;
  } | null;
}

/** 文档页创建或恢复专用对话后的导航数据。 */
export interface DocumentEvidenceResolutionConversationDto {
  thread: {
    id: string;
    workspaceId: string;
    requestFormId: string;
    title: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  };
  autoStart: boolean;
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
  profileId,
}: {
  workspaceId: string;
  kind: DocumentKind;
  profileId: string;
}): Promise<DocumentGenerationStatusDto> {
  if (kind !== "prd") {
    throw new DocumentGenerationServiceError("当前仅支持生成 PRD。", 400);
  }

  let modelProfile: ModelUsageProfile;
  try {
    modelProfile = await getLocalModelProfile(profileId);
  } catch (error) {
    if (error instanceof ModelProfileNotFoundError) {
      throw new DocumentGenerationServiceError("模型使用列表不存在。", 404);
    }
    throw error;
  }

  const existingRun = await getActiveDocumentGenerationRun(workspaceId, kind);
  if (existingRun) {
    const evidenceResolution =
      existingRun.status === "awaiting_input"
        ? await findDocumentEvidenceResolutionByRunId(existingRun.id)
        : null;
    return {
      run: existingRun,
      artifact: existingRun.documentArtifactId
        ? await getDocumentArtifactByRunId(existingRun.id)
        : null,
      evidenceResolution: toEvidenceResolutionSummary(evidenceResolution),
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

  launchDocumentGenerationRun(run, graph, modelProfile);

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
  const [artifact, evidenceResolution] = await Promise.all([
    run.documentArtifactId ? getDocumentArtifactByRunId(run.id) : null,
    run.status === "awaiting_input"
      ? findDocumentEvidenceResolutionByRunId(run.id)
      : null,
  ]);

  return {
    run,
    artifact,
    evidenceResolution: toEvidenceResolutionSummary(evidenceResolution),
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
  const [artifact, evidenceResolution] = await Promise.all([
    run.documentArtifactId ? getDocumentArtifactByRunId(run.id) : null,
    run.status === "awaiting_input"
      ? findDocumentEvidenceResolutionByRunId(run.id)
      : null,
  ]);

  return {
    run,
    artifact,
    evidenceResolution: toEvidenceResolutionSummary(evidenceResolution),
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
 * 为 awaiting_input PRD run 创建或恢复专用证据解决会话。
 */
export async function createDocumentEvidenceResolutionConversation({
  runId,
  profileId,
}: {
  runId: string;
  profileId: string;
}): Promise<DocumentEvidenceResolutionConversationDto> {
  const run = await getDocumentGenerationRunById(runId);
  if (!run) throw new DocumentGenerationServiceError("文档任务不存在。", 404);
  if (run.status !== "awaiting_input") {
    throw new DocumentGenerationServiceError(
      "只有等待补充信息的文档任务可以解决证据阻断。",
      409,
    );
  }

  const existing = await findDocumentEvidenceResolutionByRunId(runId);
  if (existing) {
    const conversation = await getConversationById(existing.conversationId);
    if (conversation && conversation.workspaceId === run.workspaceId) {
      return {
        thread: {
          id: conversation.id,
          workspaceId: conversation.workspaceId,
          requestFormId: existing.requestFormId,
          title: conversation.title,
          messageCount: existing.status === "ready" ? 0 : 1,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
        autoStart: existing.status === "ready",
      };
    }
  }

  try {
    await getLocalModelProfile(profileId);
  } catch (error) {
    if (error instanceof ModelProfileNotFoundError) {
      throw new DocumentGenerationServiceError("模型使用列表不存在。", 404);
    }
    throw error;
  }

  const artifact = await getDocumentArtifactByRunId(runId);
  let sourceGraphVersion = artifact?.content?.sourceGraphStats.version;
  if (typeof sourceGraphVersion !== "number") {
    const currentGraph = await loadDocumentSourceGraph(run.workspaceId);
    sourceGraphVersion =
      await ensureDocumentArtifactSourceGraphVersion({
        runId,
        workspaceId: run.workspaceId,
        sourceGraphVersion: currentGraph.version,
      });
  }
  if (typeof sourceGraphVersion !== "number") {
    throw new DocumentGenerationServiceError(
      "无法为当前文档产物补齐源知识图谱版本，请刷新后重试。",
      409,
    );
  }
  const latestAttempt = run.scoringAttempts.at(-1);
  const blockers: DocumentEvidenceBlocker[] =
    latestAttempt?.reviewerScores.flatMap((reviewer) =>
      (reviewer.evidenceBlockers ?? []).map((text) => ({
        index: 0,
        reviewerId: reviewer.reviewerId,
        reviewerName: reviewer.reviewerName,
        text,
      })),
    ) ?? [];
  const reviewerBlockerTexts = new Set(blockers.map((blocker) => blocker.text));
  for (const text of latestAttempt?.evidenceBlockers ?? []) {
    if (reviewerBlockerTexts.has(text)) continue;
    blockers.push({
      index: blockers.length,
      reviewerId: "source-grounding-validator",
      reviewerName: "PRD Source Grounding Validator",
      text,
    });
  }
  blockers.forEach((blocker, index) => {
    blocker.index = index;
  });
  if (blockers.length === 0) {
    throw new DocumentGenerationServiceError(
      "当前评分结果没有可解决的证据阻断。",
      409,
    );
  }

  const created = await createChat(run.workspaceId, "解决 PRD 证据阻断");
  await selectConversationModelProfile(created.chat.id, profileId);
  await createDocumentEvidenceResolutionItem({
    requestFormId: created.requestForm.id,
    runId,
    sourceGraphVersion,
    blockers,
  });
  return {
    thread: {
      id: created.chat.id,
      workspaceId: created.chat.workspaceId,
      requestFormId: created.requestForm.id,
      title: created.chat.title,
      messageCount: 0,
      createdAt: created.chat.createdAt,
      updatedAt: created.chat.updatedAt,
    },
    autoStart: true,
  };
}

/**
 * 在知识图谱补充完成后恢复原 PRD run 的剩余评分轮次。
 */
export async function resumeDocumentGeneration({
  runId,
  profileId,
}: {
  runId: string;
  profileId: string;
}): Promise<DocumentGenerationStatusDto> {
  const run = await getDocumentGenerationRunById(runId);
  if (!run) {
    throw new DocumentGenerationServiceError("文档任务不存在。", 404);
  }
  if (run.status !== "awaiting_input") {
    throw new DocumentGenerationServiceError(
      "只有等待补充信息的文档任务可以继续。",
      409,
    );
  }
  if (run.scoringAttempts.length >= DOCUMENT_SCORE_MAX_ATTEMPTS) {
    throw new DocumentGenerationServiceError("文档评分轮次已经用完。", 409);
  }

  const artifact = await getDocumentArtifactByRunId(runId);
  const sourceVersion = artifact?.content?.sourceGraphStats.version;
  const graph = await loadDocumentSourceGraph(run.workspaceId);
  const evidenceResolution = await findDocumentEvidenceResolutionByRunId(runId);
  if (
    typeof sourceVersion !== "number" ||
    evidenceResolution?.status !== "completed" ||
    typeof evidenceResolution.resolvedGraphVersion !== "number" ||
    evidenceResolution.resolvedGraphVersion <= sourceVersion ||
    typeof graph.version !== "number" ||
    graph.version < evidenceResolution.resolvedGraphVersion
  ) {
    throw new DocumentGenerationServiceError(
      "产品知识图谱尚未更新，请先完成证据阻断解决流程。",
      409,
    );
  }

  let modelProfile: ModelUsageProfile;
  try {
    modelProfile = await getLocalModelProfile(profileId);
  } catch (error) {
    if (error instanceof ModelProfileNotFoundError) {
      throw new DocumentGenerationServiceError("模型使用列表不存在。", 404);
    }
    throw error;
  }

  if (!(await resumeAwaitingDocumentGenerationRun(runId))) {
    throw new DocumentGenerationServiceError("文档任务已被其他请求恢复。", 409);
  }

  const latestAttempt = run.scoringAttempts.at(-1);
  launchDocumentGenerationRun(run, graph, modelProfile, {
    priorScoreAttempts: run.scoringAttempts,
    revisionFeedback: latestAttempt
      ? createScoreRetryFeedback(latestAttempt)
      : "",
    workflowThreadId: `${run.workflowThreadId}:attempt:${run.scoringAttempts.length + 1}`,
    alreadyRunning: true,
  });

  return {
    run: { ...run, status: "running", finishedAt: null },
    artifact,
    evidenceResolution: toEvidenceResolutionSummary(evidenceResolution),
  };
}

/** 将内部 request-form 记录压缩为文档页只读状态。 */
function toEvidenceResolutionSummary(
  resolution: Awaited<ReturnType<typeof findDocumentEvidenceResolutionByRunId>>,
): DocumentGenerationStatusDto["evidenceResolution"] {
  return resolution
    ? {
        status: resolution.status,
        sourceGraphVersion: resolution.sourceGraphVersion,
        ...(typeof resolution.resolvedGraphVersion === "number"
          ? { resolvedGraphVersion: resolution.resolvedGraphVersion }
          : {}),
      }
    : null;
}

/**
 * 从产品知识图谱服务加载文档生成所需图谱。
 */
async function loadDocumentSourceGraph(workspaceId: string): Promise<{
  nodes: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
  version: number;
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
    version: graph.version,
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
    version: number;
  },
  modelProfile: ModelUsageProfile,
  resume?: {
    priorScoreAttempts: DocumentScoreAttempt[];
    revisionFeedback: string;
    workflowThreadId: string;
    alreadyRunning: boolean;
  },
): void {
  const controller = new AbortController();
  activeDocumentRuns.set(run.id, controller);

  void executeDocumentGenerationRun(
    run,
    graph,
    modelProfile,
    controller,
    resume,
  ).finally(() => {
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
    version: number;
  },
  modelProfile: ModelUsageProfile,
  controller: AbortController,
  resume?: {
    priorScoreAttempts: DocumentScoreAttempt[];
    revisionFeedback: string;
    workflowThreadId: string;
    alreadyRunning: boolean;
  },
): Promise<void> {
  let latestTodos = run.todos;
  let latestReasoning = run.reasoningLog;
  let latestScoringAttempts = run.scoringAttempts;
  let result: DocumentGenerationResult | null = null;

  try {
    if (!resume?.alreadyRunning) {
      await markDocumentGenerationRunRunning({ runId: run.id });
    }
    const stream = streamDocumentWorkflow({
      workspaceId: run.workspaceId,
      runId: run.id,
      kind: run.kind,
      graph,
      priorScoreAttempts: resume?.priorScoreAttempts,
      revisionFeedback: resume?.revisionFeedback,
      modelProfile,
      workflowThreadId: resume?.workflowThreadId ?? run.workflowThreadId,
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
        latestReasoning = appendReasoningLog(latestReasoning, {
          agentType: "document-workflow",
          content: `进入阶段：${event.label}`,
        });
        await updateDocumentGenerationRunProgress({
          runId: run.id,
          reasoningLog: latestReasoning,
        });
      }
      if (event.type === "todo-update") {
        latestTodos = event.todos;
        await updateDocumentGenerationRunProgress({
          runId: run.id,
          todos: latestTodos,
        });
      }
      if (event.type === "reasoning") {
        latestReasoning = appendReasoningLog(latestReasoning, {
          agentType: event.agentType,
          content: event.content,
        });
        await updateDocumentGenerationRunProgress({
          runId: run.id,
          reasoningLog: latestReasoning,
        });
      }
      if (event.type === "document-score-attempt") {
        latestScoringAttempts = upsertScoreAttempt(
          latestScoringAttempts,
          event.attempt,
        );
        await updateDocumentGenerationRunProgress({
          runId: run.id,
          scoringAttempts: latestScoringAttempts,
        });
      }
      if (event.type === "document-complete") {
        result = event.result;
        latestScoringAttempts = result.qualityScore.attempts;
      }

      next = await stream.next();
    }

    result = result ?? next.value.result;
    latestTodos = next.value.todos.length > 0 ? next.value.todos : latestTodos;

    if (controller.signal.aborted) {
      throw createAbortError();
    }

    const latestAttempt = result.qualityScore.attempts.at(-1);
    const awaitingInput = Boolean(
      latestAttempt?.evidenceBlocked &&
        !result.qualityScore.passed &&
        result.qualityScore.attempts.length < result.qualityScore.maxAttempts,
    );
    await completeDocumentGenerationRun({
      runId: run.id,
      workspaceId: run.workspaceId,
      kind: run.kind,
      result,
      todos: latestTodos,
      status: awaitingInput ? "awaiting_input" : "completed",
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
 * 追加思考日志，并把同一 Agent 的流式增量合并到同一条记录。
 */
function appendReasoningLog(
  entries: DocumentReasoningLogEntry[],
  next: {
    agentType: string;
    content: string;
  },
): DocumentReasoningLogEntry[] {
  const content = next.content;
  if (!content.trim()) return entries;
  const latestEntry = entries.at(-1);

  if (latestEntry && shouldMergeReasoningEntry(latestEntry, next.agentType)) {
    const mergedContent = `${latestEntry.content}${content}`;
    return [
      ...entries.slice(0, -1),
      {
        ...latestEntry,
        content: mergedContent,
        createdAt: new Date().toISOString(),
      },
    ].slice(-80);
  }

  return [
    ...entries,
    {
      index: entries.length,
      agentType: next.agentType,
      content,
      createdAt: new Date().toISOString(),
    },
  ].slice(-80);
}

/**
 * 判断流式 reasoning chunk 是否应合并为同一条展示记录。
 */
function shouldMergeReasoningEntry(
  latestEntry: DocumentReasoningLogEntry,
  nextAgentType: string,
): boolean {
  return (
    latestEntry.agentType === nextAgentType &&
    latestEntry.agentType !== "document-workflow"
  );
}

/**
 * 写入或替换同一轮评分结果。
 */
function upsertScoreAttempt(
  attempts: DocumentScoreAttempt[],
  next: DocumentScoreAttempt,
): DocumentScoreAttempt[] {
  const filtered = attempts.filter((attempt) => attempt.attempt !== next.attempt);
  return [...filtered, next].sort((a, b) => a.attempt - b.attempt);
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

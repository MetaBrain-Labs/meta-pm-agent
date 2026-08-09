/**
 * 文档生成 API 客户端
 *
 * 封装策划产出文档页面所需的后台任务接口，包括启动 PRD 生成、查询最新状态、
 * 查询单个 run 和手动中断。
 *
 * Responsibilities:
 * - 提供类型化的文档生成 HTTP 调用
 * - 解析服务端错误并保留可读文案
 * - 隔离页面组件与 API 路径细节
 */

import type { TodoItem } from "../types";
import type { ThreadInfo } from "../types";

export type DocumentKind = "prd" | "mrd" | "brd";
export type DocumentGenerationStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "completed"
  | "stopped"
  | "failed";
export type DocumentWorkflowStage =
  | "parseKg"
  | "normalizeGraph"
  | "buildSectionDossiers"
  | "draftSection"
  | "crossCheck"
  | "scoreDraft"
  | "groupEvidenceBlockers"
  | "aggregateScore"
  | "humanReview"
  | "exportPrd";

export interface DocumentReasoningLogEntry {
  index: number;
  agentType: string;
  content: string;
  createdAt: string;
}

export interface DocumentScoreAttempt {
  attempt: number;
  markdown: string;
  reviewerScores: Array<{
    reviewerId: string;
    reviewerName: string;
    score: number;
    dimensions: Record<string, number>;
    strengths: string[];
    weaknesses: string[];
    revisionAdvice: string[];
    evidenceBlocked?: boolean;
    evidenceBlockers?: string[];
    evidenceBlockerDetails?: Array<{
      text: string;
      relatedNodeIds: string[];
    }>;
  }>;
  scoreSpread: number;
  varianceAccepted: boolean;
  aggregate: {
    score: number;
    passed: boolean;
    confidence: number;
    rationale: string;
    requiredRevisions: string[];
    weights: {
      averageScore: number;
      minimumScore: number;
      spreadPenalty: number;
      consistencyBonus: number;
    };
  };
  passed: boolean;
  evidenceBlocked?: boolean;
  evidenceBlockers?: string[];
  evidenceBlockerGroups?: DocumentEvidenceBlockerGroup[];
  evidenceBlockerGroupingStatus?: "grouped" | "fallback";
  selected: boolean;
}

export interface DocumentEvidenceBlockerGroup {
  id: string;
  title: string;
  description: string;
  sourceIndexes: number[];
  relatedNodeIds: string[];
  sources: Array<{
    reviewerId: string;
    reviewerName: string;
    text: string;
    relatedNodeIds: string[];
  }>;
}

export interface DocumentQualityScore {
  threshold: number;
  maxAllowedScoreSpread: number;
  maxAttempts: number;
  selectedAttempt: number;
  finalScore: number;
  passed: boolean;
  selectionReason: string;
  attempts: DocumentScoreAttempt[];
}

export interface DocumentGenerationRun {
  id: string;
  workspaceId: string;
  kind: DocumentKind;
  status: DocumentGenerationStatus;
  workflowThreadId: string;
  currentStage: DocumentWorkflowStage | null;
  todos: TodoItem[];
  reasoningLog: DocumentReasoningLogEntry[];
  scoringAttempts: DocumentScoreAttempt[];
  documentArtifactId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentArtifact {
  id: string;
  workspaceId: string;
  runId: string;
  kind: DocumentKind;
  title: string;
  markdown: string;
  content: {
    qualityScore?: DocumentQualityScore;
    sourceGraphStats?: {
      nodeCount: number;
      relationCount: number;
      version?: number;
    };
  } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentGenerationStatusResponse {
  run: DocumentGenerationRun | null;
  artifact: DocumentArtifact | null;
  evidenceResolution?: {
    status: string;
    sourceGraphVersion: number;
    resolvedGraphVersion?: number;
  } | null;
}

export interface DocumentEvidenceResolutionResponse {
  thread: ThreadInfo;
  autoStart: boolean;
}

/**
 * 启动指定工作区的文档生成任务。
 */
export async function startDocumentGeneration(
  workspaceId: string,
  kind: DocumentKind,
  profileId: string,
): Promise<DocumentGenerationStatusResponse> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/document-generation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, profileId }),
    },
  );

  return readJsonResponse<DocumentGenerationStatusResponse>(response);
}

/**
 * 查询指定工作区的最新文档生成任务。
 */
export async function fetchLatestDocumentGeneration(
  workspaceId: string,
  kind: DocumentKind,
): Promise<DocumentGenerationStatusResponse> {
  const params = new URLSearchParams({ kind });
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/document-generation/latest?${params.toString()}`,
  );

  return readJsonResponse<DocumentGenerationStatusResponse>(response);
}

/**
 * 查询单个文档生成 run。
 */
export async function fetchDocumentGenerationRun(
  runId: string,
): Promise<DocumentGenerationStatusResponse> {
  const response = await fetch(
    `/api/document-generation/${encodeURIComponent(runId)}`,
  );

  return readJsonResponse<DocumentGenerationStatusResponse>(response);
}

/**
 * 手动停止文档生成 run。
 */
export async function stopDocumentGeneration(runId: string): Promise<void> {
  const response = await fetch(
    `/api/document-generation/${encodeURIComponent(runId)}/stop`,
    { method: "POST" },
  );
  await readJsonResponse<{ stopped: boolean }>(response);
}

/**
 * 创建或恢复证据阻断专用会话。
 */
export async function createDocumentEvidenceResolution(
  runId: string,
  profileId: string,
): Promise<DocumentEvidenceResolutionResponse> {
  const response = await fetch(
    `/api/document-generation/${encodeURIComponent(runId)}/evidence-resolution`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    },
  );
  return readJsonResponse<DocumentEvidenceResolutionResponse>(response);
}

/**
 * 在权威知识图谱版本更新后恢复原 PRD run。
 */
export async function resumeDocumentGeneration(
  runId: string,
  profileId: string,
): Promise<DocumentGenerationStatusResponse> {
  const response = await fetch(
    `/api/document-generation/${encodeURIComponent(runId)}/resume`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    },
  );
  return readJsonResponse<DocumentGenerationStatusResponse>(response);
}

/**
 * 读取 JSON 响应并保留服务端错误文案。
 */
async function readJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error)
        : `Server error: ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

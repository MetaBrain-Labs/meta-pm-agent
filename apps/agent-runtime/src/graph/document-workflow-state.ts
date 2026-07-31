/**
 * 文档生成 LangGraph 状态定义
 *
 * 定义 Document Agent 独立工作流的跨节点状态。该状态只服务文档生成图，
 * 与用户对话产出知识图谱的主图分离，避免两个工作流互相污染。
 *
 * Responsibilities:
 * - 保存原始知识图谱、规范化图谱、章节材料和草稿
 * - 保存 Document Agent 的 Task planning 与最终生成结果
 * - 为 checkpoint 恢复提供稳定状态结构
 *
 * Notes:
 * - 当前状态机支持 PRD；MRD/BRD 后续可复用同一状态结构。
 */

import { Annotation } from "@langchain/langgraph";
import type {
  DocumentGenerationResult,
  DocumentKind,
  DocumentSectionDraft,
  DocumentTodo,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
} from "@repo/shared";
import type {
  DocumentScoreAttempt,
  DocumentScoreReview,
} from "../agents/document-agent/scoring";

/**
 * 文档工作流中的规范化图谱快照。
 */
export interface DocumentWorkflowGraphSnapshot {
  nodes: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
}

/**
 * 单个章节生成前的证据包。
 */
export interface DocumentSectionDossier {
  id: string;
  title: string;
  purpose: string;
  nodeIds: string[];
  relationIds: string[];
  evidence: string[];
}

/**
 * 文档交叉检查结果。
 */
export interface DocumentCrossCheck {
  passed: boolean;
  notes: string[];
}

/**
 * Document Agent 独立 LangGraph 状态。
 */
export const DocumentWorkflowGraphState = Annotation.Root({
  workspaceId: Annotation<string>(),
  runId: Annotation<string>(),
  kind: Annotation<DocumentKind>(),
  sourceGraph: Annotation<DocumentWorkflowGraphSnapshot>({
    reducer: (_current, update) => update,
    default: () => ({ nodes: [], relations: [] }),
  }),
  normalizedGraph: Annotation<DocumentWorkflowGraphSnapshot | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  dossiers: Annotation<DocumentSectionDossier[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  sectionDrafts: Annotation<DocumentSectionDraft[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  draftMarkdown: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  todos: Annotation<DocumentTodo[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  crossCheckResult: Annotation<DocumentCrossCheck | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  sourceGroundingIssues: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  scoreReviewerReports: Annotation<DocumentScoreReview[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  scoreAttempts: Annotation<DocumentScoreAttempt[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  scoreFeedback: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  reviewStatus: Annotation<"pending" | "auto_approved" | "approved">({
    reducer: (_current, update) => update,
    default: () => "pending",
  }),
  result: Annotation<DocumentGenerationResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export type DocumentWorkflowGraphStateValue =
  typeof DocumentWorkflowGraphState.State;

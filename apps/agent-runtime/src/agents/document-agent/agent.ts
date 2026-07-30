/**
 * Document Agent 执行器
 *
 * 负责组装 PRD Document Agent 的输入 payload、运行时 SubAgent 上下文和
 * 对外流式入口。具体 DeepAgents 驱动逻辑由 Document 专属 runDocumentAgent 承载。
 *
 * Responsibilities:
 * - streamPrdDocumentAgent()：基于知识图谱启动 PRD 生成
 * - createRuntimePrdSubagents()：为 PRD 子代理注入运行时图谱上下文
 * - 维持 document-workflow 对 Document Agent 的稳定入口
 *
 * Notes:
 * - Document Agent 不写知识图谱；知识图谱是输入事实源。
 */

import type { SubAgent } from "deepagents";
import type {
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
} from "@repo/shared";
import { createDeepAgentToolAllowlistMiddleware } from "../common/deep-agent-tool-policy";
import {
  runDocumentAgent,
  type DocumentAgentStreamEvent,
} from "./run-document-agent";
import { PRD_DOCUMENT_SUBAGENTS } from "./prompt";
import { createPrdDocumentSkillBundle } from "./skills";

export { sanitizePrdMarkdown } from "./run-document-agent";
export type { DocumentAgentStreamEvent } from "./run-document-agent";

/**
 * Document Agent 的输入载荷。
 */
export interface PrdDocumentAgentInput {
  workspaceId: string;
  runId: string;
  graph: {
    nodes: KnowledgeGraphEntity[];
    relations: KnowledgeGraphRelation[];
  };
  dossiers: Array<{
    id: string;
    title: string;
    purpose: string;
    nodeIds: string[];
    relationIds: string[];
    evidence: string[];
  }>;
  attemptNumber?: number;
  revisionFeedback?: string;
  signal?: AbortSignal;
}

const SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS = 120_000;

/**
 * 运行 PRD Document Agent，返回最终 Markdown 文档。
 */
export async function* streamPrdDocumentAgent(
  input: PrdDocumentAgentInput,
): AsyncGenerator<DocumentAgentStreamEvent, string, void> {
  const skillBundle = await createPrdDocumentSkillBundle();
  const documentSubagentToolAllowlistMiddleware =
    createDeepAgentToolAllowlistMiddleware({
      agentName: "document-agent-prd-subagent",
      allowedToolNames: ["read_file"],
    });
  const agentPayload = {
    task: "Generate a complete PRD from the supplied product knowledge graph.",
    workspaceId: input.workspaceId,
    runId: input.runId,
    attemptNumber: input.attemptNumber ?? 1,
    revisionFeedback: input.revisionFeedback ?? "",
    taskDelegationPolicy:
      "When using task subagents, include all relevant graph nodes, relations, section dossier evidence, and draft excerpts directly in the task description. Subagents may read only their assigned virtual /skills instructions and must not look for external files or graph context.",
    graph: input.graph,
    sectionDossiers: input.dossiers,
  };
  const markdown = yield* runDocumentAgent({
    payload: agentPayload,
    skills: skillBundle.sources,
    skillFiles: skillBundle.files,
    subagents: createRuntimePrdSubagents(
      input,
      documentSubagentToolAllowlistMiddleware,
    ),
    signal: input.signal,
  });

  return markdown;
}

/**
 * 为 PRD 子代理注入当前运行的知识图谱上下文。
 */
function createRuntimePrdSubagents(
  input: PrdDocumentAgentInput,
  documentSubagentToolAllowlistMiddleware: ReturnType<
    typeof createDeepAgentToolAllowlistMiddleware
  >,
): SubAgent[] {
  const runtimeContext = createSubagentRuntimeContext(input);

  return PRD_DOCUMENT_SUBAGENTS.map((subagent) => ({
    ...subagent,
    systemPrompt: `${subagent.systemPrompt}\n\n${runtimeContext}`,
    middleware: [
      ...((subagent as { middleware?: unknown[] }).middleware ?? []),
      documentSubagentToolAllowlistMiddleware,
    ],
  })) as SubAgent[];
}

/**
 * 构造子代理可直接读取的紧凑知识图谱上下文。
 */
function createSubagentRuntimeContext(input: PrdDocumentAgentInput): string {
  const context = JSON.stringify({
    workspaceId: input.workspaceId,
    runId: input.runId,
    attemptNumber: input.attemptNumber ?? 1,
    revisionFeedback: input.revisionFeedback ?? "",
    graph: {
      nodes: input.graph.nodes.map(compactKnowledgeGraphNode),
      relations: input.graph.relations.map(compactKnowledgeGraphRelation),
    },
    sectionDossiers: input.dossiers,
  });
  const compactContext =
    context.length > SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS
      ? `${context.slice(0, SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS)}`
      : context;
  const truncationNote =
    context.length > SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS
      ? "\nThe runtime context was truncated for token budget. Use the available evidence and explicitly mark gaps."
      : "";

  return [
    "Runtime knowledge graph context:",
    "Use this context as the authoritative product graph even if the delegated task description is short.",
    "Do not claim that no knowledge graph evidence was provided unless this runtime context is empty.",
    `<knowledge_graph_context>${compactContext}</knowledge_graph_context>${truncationNote}`,
  ].join("\n");
}

/**
 * 压缩知识图谱节点，保留生成 PRD 所需字段。
 */
function compactKnowledgeGraphNode(node: KnowledgeGraphEntity) {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    description: node.description,
    source_task_id: node.source_task_id,
    status: node.status,
  };
}

/**
 * 压缩知识图谱关系，保留生成 PRD 所需字段。
 */
function compactKnowledgeGraphRelation(relation: KnowledgeGraphRelation) {
  return {
    id: relation.id,
    type: relation.type,
    source: relation.source,
    target: relation.target,
    description: relation.description,
    source_task_id: relation.source_task_id,
  };
}

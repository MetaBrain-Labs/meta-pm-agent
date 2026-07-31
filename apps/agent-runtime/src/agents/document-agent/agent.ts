/**
 * Document Agent 执行器
 *
 * 负责组装紧凑的 PRD Document Agent 输入 payload 和对外流式入口。
 * 具体 DeepAgents 驱动逻辑由 Document 专属 runDocumentAgent 承载。
 *
 * Responsibilities:
 * - streamPrdDocumentAgent()：基于知识图谱启动 PRD 生成
 * - createPrdDocumentAgentPayload()：去除重复章节证据与非必要图谱字段
 * - 维持 document-workflow 对 Document Agent 的稳定入口
 *
 * Notes:
 * - Document Agent 不写知识图谱；知识图谱是输入事实源。
 */

import type {
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
} from "@repo/shared";
import {
  runDocumentAgent,
  type DocumentAgentStreamEvent,
} from "./run-document-agent";
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

/**
 * 运行 PRD Document Agent，返回最终 Markdown 文档。
 */
export async function* streamPrdDocumentAgent(
  input: PrdDocumentAgentInput,
): AsyncGenerator<DocumentAgentStreamEvent, string, void> {
  const skillBundle = await createPrdDocumentSkillBundle();
  const agentPayload = createPrdDocumentAgentPayload(input);
  const markdown = yield* runDocumentAgent({
    payload: agentPayload,
    skills: skillBundle.sources,
    skillFiles: skillBundle.files,
    subagents: [],
    signal: input.signal,
  });

  return markdown;
}

/**
 * 构造不重复章节 evidence 的紧凑主 Agent payload。
 */
export function createPrdDocumentAgentPayload(input: PrdDocumentAgentInput) {
  return {
    task: "Generate a complete PRD from the supplied product knowledge graph.",
    workspaceId: input.workspaceId,
    runId: input.runId,
    attemptNumber: input.attemptNumber ?? 1,
    revisionFeedback: input.revisionFeedback ?? "",
    graph: {
      nodes: input.graph.nodes.map(compactKnowledgeGraphNode),
      relations: input.graph.relations.map(compactKnowledgeGraphRelation),
    },
    sectionDossiers: input.dossiers.map(
      ({ id, title, purpose, nodeIds, relationIds }) => ({
        id,
        title,
        purpose,
        nodeIds: nodeIds.map(compactGraphId),
        relationIds: relationIds.map(compactGraphId),
      }),
    ),
  };
}

/**
 * 压缩知识图谱节点，保留生成 PRD 所需字段。
 */
function compactKnowledgeGraphNode(node: KnowledgeGraphEntity) {
  return {
    id: compactGraphId(node.id),
    type: node.type,
    name: node.name,
    description: node.description,
    status: node.status,
  };
}

/**
 * 压缩知识图谱关系，保留生成 PRD 所需字段。
 */
function compactKnowledgeGraphRelation(relation: KnowledgeGraphRelation) {
  return {
    id: compactGraphId(relation.id),
    type: relation.type,
    source: compactGraphId(relation.source),
    target: compactGraphId(relation.target),
    description: relation.description,
  };
}

/**
 * 将模型可见图谱 ID 缩短为 PRD 使用的稳定前缀。
 */
function compactGraphId(id: string): string {
  return /^([A-Z]+-[0-9a-f]{8})(?:-|$)/i.exec(id)?.[1] ?? id;
}

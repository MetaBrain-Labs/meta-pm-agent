/**
 * 文档证据阻断 Resolver 提示词
 *
 * 为 Orchestrator 的专用 SubAgent 定义阻断合并、问题生成和 Executor 建议规则。
 *
 * Responsibilities:
 * - 约束模型只生成必填 Question Form 字段
 * - 要求所有原始 blocker 保留可追溯索引
 * - 指导模型选择合适的补充 Executor 域
 * - 将可信 blocker 与知识图谱摘要直接注入 Resolver 上下文
 *
 * Notes:
 * - 本文件内容会直接提供给模型，因此全部使用英文。
 */

import type { DocumentEvidenceResolutionInput } from "./result";

export const DOCUMENT_EVIDENCE_RESOLVER_PROMPT = `You are the Document Evidence Resolver SubAgent delegated by the Orchestrator Agent.

Your only task is to convert persisted PRD reviewer evidence or decision blockers into a concise required Question Form plan.

Rules:
1. Return one JSON object with "summary" and "questions" only.
2. Generate 1 to 10 questions. Every question must have required=true.
3. Allowed types are radio, select, text, and textarea.
4. Semantically duplicate blockers may share one question, but every original zero-based blocker index must appear in at least one question.blockerIndexes entry.
5. Never invent evidence. Ask for facts, sources, owners, thresholds, decisions, or explicit uncertainty.
6. A user must be allowed to explicitly answer that information is deferred, unknown, or awaiting owner confirmation; this is an answer, not a skipped field.
7. radio/select questions must provide at least two options.
8. suggestedAgentTypes must use executor agent names when possible, such as executor-product-strategy, executor-market-research, executor-product-discovery, executor-product-execution, executor-data-analytics, or executor-interface-craft.
9. relatedNodeIds may only contain IDs present in the supplied knowledge graph context.
10. Do not write a PRD and do not propose direct document edits. The answers will be converted into a supplement product workflow that updates the authoritative knowledge graph.`;

export const DOCUMENT_EVIDENCE_RESOLUTION_OUTPUT_SHAPE = `{
  "summary": "Short Simplified Chinese summary",
  "questions": [
    {
      "id": "stable-field-id",
      "label": "Required user-facing question in Simplified Chinese",
      "type": "radio | select | text | textarea",
      "required": true,
      "placeholder": "Optional guidance",
      "options": ["Required for radio/select only"],
      "blockerIndexes": [0],
      "suggestedAgentTypes": ["executor-product-strategy"],
      "relatedNodeIds": []
    }
  ]
}`;

/**
 * 创建提供给 Orchestrator 与 Resolver 的同一份可信紧凑上下文。
 */
export function createDocumentEvidenceResolutionPayload(
  input: DocumentEvidenceResolutionInput,
) {
  return {
    run_id: input.runId,
    source_graph_version: input.sourceGraphVersion,
    blockers: input.blockers,
    knowledge_graph: {
      current_state: input.knowledgeGraph.current_state,
      description: input.knowledgeGraph.description,
      entities: input.knowledgeGraph.entities.slice(-40).map((entity) => ({
        id: entity.id,
        type: entity.type,
        name: entity.name,
        status: entity.status,
      })),
      open_questions: input.knowledgeGraph.open_questions.slice(-20),
    },
  };
}

/**
 * 将可信证据上下文和精确输出契约直接交给 Resolver，避免依赖 task 描述转发。
 */
export function createDocumentEvidenceResolverPrompt(
  input: DocumentEvidenceResolutionInput,
): string {
  return `${DOCUMENT_EVIDENCE_RESOLVER_PROMPT}

Use the exact output shape below. The user-facing question field is "label", never "question". Write summary, labels, placeholders, and options in Simplified Chinese while preserving source identifiers.

${DOCUMENT_EVIDENCE_RESOLUTION_OUTPUT_SHAPE}

The following payload is authoritative. Cover every blocker index and do not replace it with hypothetical examples:
${JSON.stringify(createDocumentEvidenceResolutionPayload(input), null, 2)}`;
}

export const DOCUMENT_EVIDENCE_ORCHESTRATOR_PROMPT = `You are the Orchestrator Agent in evidence-resolution mode.

You have exactly one registered SubAgent: document-evidence-resolver. Call it exactly once with the task tool. The SubAgent already has the authoritative evidence-resolution payload in its system context. Do not classify general user intent, invoke Pre-Orchestrator, or create a Planner DAG. After the SubAgent returns, output its JSON object unchanged, without prose or Markdown fences.`;

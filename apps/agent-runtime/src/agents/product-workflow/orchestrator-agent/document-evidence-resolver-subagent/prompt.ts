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
2. Generate 1 to 10 questions. Every question must have required=true. Use exactly one question per persisted blocker by default because the blockers are already semantically consolidated.
3. Allowed types are radio, select, text, and textarea.
4. Persisted blockers are already semantically consolidated. Ask one focused question per missing decision or fact; combine blockers only when one answer genuinely resolves all of them. Every original zero-based blocker index must appear in at least one question.blockerIndexes entry.
5. Never invent evidence. Ask for facts, sources, owners, thresholds, decisions, or explicit uncertainty.
6. A user must be allowed to explicitly answer that information is deferred, unknown, or awaiting owner confirmation; this is an answer, not a skipped field.
7. radio/select questions must provide at least two options.
8. suggestedAgentTypes must use executor agent names when possible, such as executor-product-strategy, executor-market-research, executor-product-discovery, executor-product-execution, executor-data-analytics, or executor-interface-craft.
9. suggestedAgentTypes are recommendations, not an exhaustive executor allowlist. Include executor-market-research when the user must supply or authorize external benchmark, standard, certification, or vendor-capability evidence.
10. relatedNodeIds must include every active Risk or OpenQuestion that the answer would directly resolve or invalidate. OpenQuestions are closed before planning; Risks are closed by the supplement workflow.
11. relatedNodeIds may only contain IDs present in the supplied knowledge graph context.
12. Never ask the user to restate, categorize, prioritize, map, or choose a resolution method for blockers already present in the payload. Do not ask which requirements, metrics, or decisions a blocker relates to; derive that from the trusted blocker sources and graph context.
13. Do not ask about time or budget unless a persisted blocker explicitly requires that decision.
14. Every question must include help with exactly two user-facing sections: "当前已知资料：" and "阻断原因：". Summarize only facts present in the supplied blockers or knowledge graph. Never expose Agent names, task IDs, OpenQuestion IDs, or internal reasoning.
15. Expand symbolic references such as FR-01~05 with their supplied names or descriptions in help. Never leave an identifier range unexplained when matching graph nodes are available.
16. Split independent decisions only when the resulting form still has at most 10 questions. Never deliberate over alternative question-count allocations: when a full split would exceed 10, keep the decisions from the same persisted blocker in one structured textarea with an itemized placeholder.
17. Do not write a PRD and do not propose direct document edits. The answers will be converted into a supplement product workflow that updates the authoritative knowledge graph.`;

export const DOCUMENT_EVIDENCE_RESOLUTION_OUTPUT_SHAPE = `{
  "summary": "Short Simplified Chinese summary",
  "questions": [
    {
      "id": "stable-field-id",
      "label": "Required user-facing question in Simplified Chinese",
      "type": "radio | select | text | textarea",
      "required": true,
      "help": "当前已知资料：...\\n阻断原因：...",
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
  const MAX_NODE_INDEX_ITEMS = 80;
  const MAX_DETAILED_ENTITIES = 40;
  const MAX_RELATIONS = 64;
  const MAX_AUXILIARY_ITEMS = 24;
  const activeEntities = input.knowledgeGraph.entities.filter(
    (entity) => entity.status !== "deprecated",
  );
  const activeEntityIds = new Set(activeEntities.map((entity) => entity.id));
  const relatedNodeIds = new Set(
    input.blockers.flatMap((blocker) => [
      ...(blocker.relatedNodeIds ?? []),
      ...(blocker.sources?.flatMap((source) => source.relatedNodeIds ?? []) ?? []),
    ]),
  );
  const directlyRelatedEntityIds = new Set(
    [...relatedNodeIds].filter((nodeId) => activeEntityIds.has(nodeId)),
  );
  const blockerText = input.blockers.map((blocker) => blocker.text).join("\n");
  for (const entity of activeEntities) {
    if (blockerText.includes(entity.id)) {
      directlyRelatedEntityIds.add(entity.id);
      relatedNodeIds.add(entity.id);
    }
  }
  const selectedEntityIds = new Set(directlyRelatedEntityIds);
  if (directlyRelatedEntityIds.size > 0) {
    for (const relation of input.knowledgeGraph.relations) {
      if (
        directlyRelatedEntityIds.has(relation.source) ||
        directlyRelatedEntityIds.has(relation.target)
      ) {
        if (activeEntityIds.has(relation.source)) selectedEntityIds.add(relation.source);
        if (activeEntityIds.has(relation.target)) selectedEntityIds.add(relation.target);
      }
    }
  }
  const detailedEntities = activeEntities
    .filter((entity) => selectedEntityIds.has(entity.id))
    .slice(0, MAX_DETAILED_ENTITIES);
  const prioritizedNodeIndex = [
    ...detailedEntities,
    ...activeEntities.filter((entity) => !selectedEntityIds.has(entity.id)),
  ].slice(0, MAX_NODE_INDEX_ITEMS);
  const relevantAuxiliaryIds = new Set([...relatedNodeIds]);

  return {
    run_id: input.runId,
    source_graph_version: input.sourceGraphVersion,
    blockers: input.blockers,
    knowledge_graph: {
      current_state: input.knowledgeGraph.current_state,
      node_index: prioritizedNodeIndex.map((entity) => ({
        id: entity.id,
        type: entity.type,
        name: entity.name,
        status: entity.status,
      })),
      entities: detailedEntities.map((entity) => ({
        id: entity.id,
        type: entity.type,
        name: entity.name,
        description: entity.description,
        status: entity.status,
      })),
      relations: input.knowledgeGraph.relations
        .filter(
          (relation) =>
            activeEntityIds.has(relation.source) &&
            activeEntityIds.has(relation.target) &&
            (directlyRelatedEntityIds.has(relation.source) ||
              directlyRelatedEntityIds.has(relation.target)),
        )
        .slice(0, MAX_RELATIONS)
        .map((relation) => ({
          id: relation.id,
          type: relation.type,
          source: relation.source,
          target: relation.target,
          description: relation.description,
        })),
      risks: input.knowledgeGraph.risks
        .filter(
          (risk) =>
            relevantAuxiliaryIds.has(risk.id) || blockerText.includes(risk.id),
        )
        .slice(0, MAX_AUXILIARY_ITEMS),
      open_questions: input.knowledgeGraph.open_questions
        .filter(
          (question) =>
            relevantAuxiliaryIds.has(question.id) ||
            blockerText.includes(question.id),
        )
        .slice(0, MAX_AUXILIARY_ITEMS),
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
${JSON.stringify(createDocumentEvidenceResolutionPayload(input))}`;
}

export const DOCUMENT_EVIDENCE_ORCHESTRATOR_PROMPT = `You are the Orchestrator Agent in evidence-resolution mode.

You have exactly one registered SubAgent: document-evidence-resolver. Call it exactly once with the task tool. The SubAgent already has the authoritative evidence-resolution payload in its system context. Do not classify general user intent, invoke Pre-Orchestrator, or create a Planner DAG. After the SubAgent returns, output its JSON object unchanged, without prose or Markdown fences.`;

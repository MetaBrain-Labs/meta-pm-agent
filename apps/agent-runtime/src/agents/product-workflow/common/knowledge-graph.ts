/**
 * 产品知识图谱公共操作
 *
 * 提供知识图谱元模型约束、初始状态构建和补丁聚合等公共工具，
 * 供 Planner 和所有 Executor Agent 复用。
 *
 * Responsibilities:
 * - PRODUCT_KNOWLEDGE_GRAPH_METAMODEL_PROMPT：定义无工具假设的图谱元模型规则
 * - PRODUCT_KNOWLEDGE_GRAPH_RULES_PROMPT：定义实体/关系类型、可追溯性和工具读取规则
 * - createProductWorkflowKnowledgeGraph()：创建初始空结构化图谱
 * - appendKnowledgeGraphPatch()：将 Executor 的产出合并到图谱状态（按类型聚合）
 */

import type { ProductKnowledgeGraph } from "@repo/shared";

/**
 * 产品知识图谱元模型的公共约束，适用于不暴露知识图谱工具的 Agent。
 */
export const PRODUCT_KNOWLEDGE_GRAPH_METAMODEL_PROMPT = `
Product knowledge graph metamodel:
- Entity types: Goal, Requirement, Evidence, Decision, Feature, Component, Metric, Risk, OpenQuestion, Custom.
- Relation types: Drives, Satisfies, Promotes, Produces, Constrains, Implements, Measures, Validates, References, Composes, Custom.
- Every output must preserve traceability from goals to requirements, decisions, features, components, and metrics whenever the available evidence supports it.
- Do not invent confirmed business facts. Put uncertainty into open_questions or risks.
- Runtime risks and open_questions are archived as Risk and OpenQuestion nodes when the graph is persisted.
- Treat the current knowledge graph state supplied in the payload as the source of truth.
`;

/**
 * 产品知识图谱工具驱动约束，供实际拥有知识图谱工具的 Executor Agent 使用。
 */
export const PRODUCT_KNOWLEDGE_GRAPH_RULES_PROMPT = `
${PRODUCT_KNOWLEDGE_GRAPH_METAMODEL_PROMPT.trim()}
- The knowledge graph state is a structured JSON object maintained in memory. Read compact state via kg_file_read before making updates.
- Query detailed graph context only when needed via kg_file_query_nodes, kg_file_query_relations, or kg_file_read_by_source_task.
- Treat the current knowledge graph state as the source of truth for follow-up executor updates.
- Use canonical directions for typed relations: Goal --Drives--> Decision; Decision --Produces--> Requirement; Feature --Satisfies--> Requirement; Component --Implements--> Feature; Metric --Measures--> Goal, Feature, or Requirement; Evidence --Validates--> Decision, Requirement, Feature, or Component; Custom/Component --Constrains--> Requirement, Feature, or Component; Composes connects same-type Goal, Requirement, Feature, or Component nodes. Use References, Promotes, or Custom only when their broader contextual meaning is explicit.
`;

/**
 * 构建当前版本的占位知识图谱上下文（结构化，无 markdown 文件）。
 */
export function createProductWorkflowKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    current_state: undefined,
    description: "",
    entities: [],
    relations: [],
    decisions: [],
    risks: [],
    open_questions: [],
    summary: [],
    markdown: "",
    notes: ["MVP placeholder: 产品设计知识图谱尚未接入正式存储。"],
  };
}

/**
 * 按稳定业务键合并图谱元素，后到内容覆盖同键旧内容。
 */
function mergeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    merged.set(key, item);
  }

  return [...merged.values()];
}

/**
 * 合并文本列表，保留首次出现顺序。
 */
function mergeTextList(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * 将 Executor 产出的结构化数据合并到知识图谱状态。
 */
export function appendKnowledgeGraphPatch({
  knowledgeGraph,
  taskId,
  agentType,
  entities,
  relations,
  decisions,
  risks,
  openQuestions,
  summary,
}: {
  knowledgeGraph: ProductKnowledgeGraph;
  taskId: string;
  agentType: string;
  entities: ProductKnowledgeGraph["entities"];
  relations: ProductKnowledgeGraph["relations"];
  decisions: ProductKnowledgeGraph["decisions"];
  risks: ProductKnowledgeGraph["risks"];
  openQuestions: ProductKnowledgeGraph["open_questions"];
  summary: string[];
}): ProductKnowledgeGraph {
  const decisionsWithSource = withSourceTaskId(decisions, taskId);
  const risksWithSource = withSourceTaskId(risks, taskId);
  const openQuestionsWithSource = withSourceTaskId(openQuestions, taskId);

  return {
    ...knowledgeGraph,
    entities: mergeByKey([...knowledgeGraph.entities, ...entities], (item) =>
      item.id.trim(),
    ),
    relations: mergeByKey(
      [...knowledgeGraph.relations, ...relations],
      (item) => item.id.trim(),
    ),
    decisions: mergeByKey(
      [...knowledgeGraph.decisions, ...decisionsWithSource],
      (item) => item.id.trim(),
    ),
    risks: mergeByKey([...knowledgeGraph.risks, ...risksWithSource], (item) =>
      item.id.trim(),
    ),
    open_questions: mergeByKey(
      [...knowledgeGraph.open_questions, ...openQuestionsWithSource],
      (item) => item.id.trim(),
    ),
    summary: mergeTextList([...knowledgeGraph.summary, ...summary]),
    notes: [
      ...knowledgeGraph.notes,
      `${taskId} 已由 ${agentType} 更新至知识图谱。`,
    ],
  };
}

/**
 * 为运行时辅助事实补齐来源任务，便于持久化成节点后仍可追溯。
 */
function withSourceTaskId<T extends { source_task_id?: string }>(
  items: T[],
  taskId: string,
): T[] {
  return items.map((item) => ({
    ...item,
    source_task_id: item.source_task_id ?? taskId,
  }));
}

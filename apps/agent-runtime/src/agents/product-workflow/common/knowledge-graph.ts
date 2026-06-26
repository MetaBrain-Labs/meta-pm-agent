/**
 * 产品知识图谱公共操作
 *
 * 提供知识图谱元模型约束、初始状态构建和补丁聚合等公共工具，
 * 供 Planner 和所有 Executor Agent 复用。
 *
 * Responsibilities:
 * - PRODUCT_KNOWLEDGE_GRAPH_RULES_PROMPT：定义实体/关系类型和可追溯性规则
 * - createProductWorkflowKnowledgeGraph()：创建初始空结构化图谱
 * - appendKnowledgeGraphPatch()：将 Executor 的产出合并到图谱状态（按类型聚合）
 */

import type { ProductKnowledgeGraph } from "@repo/shared";

/**
 * 产品知识图谱元模型的公共约束，供产品工作流 Agent 复用。
 */
export const PRODUCT_KNOWLEDGE_GRAPH_RULES_PROMPT = `
Product knowledge graph metamodel:
- Entity types: Goal, Requirement, Evidence, Decision, Feature, Component, Metric, Custom.
- Relation types: Drives, Satisfies, Promotes, Produces, Constrains, Implements, Measures, Validates, References, Composes, Custom.
- Every output must preserve traceability from goals to requirements, decisions, features, components, and metrics whenever the available evidence supports it.
- Do not invent confirmed business facts. Put uncertainty into open_questions or risks.
- The knowledge graph state is a structured JSON object maintained in memory. Read compact state via kg_file_read or kg_file_read_summary before making updates.
- Query detailed graph context only when needed via kg_file_query_nodes, kg_file_query_relations, kg_file_read_task_delta, or kg_file_read_by_source_task.
- Treat the current knowledge graph state as the source of truth for follow-up executor updates.
`;

/**
 * 构建当前版本的占位知识图谱上下文（结构化，无 markdown 文件）。
 */
export function createProductWorkflowKnowledgeGraph(): ProductKnowledgeGraph {
  return {
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
  return {
    ...knowledgeGraph,
    entities: [...knowledgeGraph.entities, ...entities],
    relations: [...knowledgeGraph.relations, ...relations],
    decisions: [...knowledgeGraph.decisions, ...decisions],
    risks: [...knowledgeGraph.risks, ...risks],
    open_questions: [...knowledgeGraph.open_questions, ...openQuestions],
    summary: [...knowledgeGraph.summary, ...summary],
    notes: [
      ...knowledgeGraph.notes,
      `${taskId} 已由 ${agentType} 更新至知识图谱。`,
    ],
  };
}

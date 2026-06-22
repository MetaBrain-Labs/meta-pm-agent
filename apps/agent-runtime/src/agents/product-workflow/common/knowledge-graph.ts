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
- The current product context and product knowledge graph may be placeholders. Treat them as context, not as confirmed final truth.
`;

/**
 * 构建当前版本的占位知识图谱上下文。
 */
export function createProductWorkflowKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    entities: [],
    relations: [],
    notes: ["MVP placeholder: 产品设计知识图谱尚未接入正式存储。"],
  };
}

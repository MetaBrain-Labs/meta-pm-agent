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
- The markdown file product-knowledge-graph.md is the working product knowledge graph.
- Treat the current markdown graph as the source of truth for follow-up executor updates.
`;

/**
 * 构建当前版本的占位知识图谱上下文。
 */
export function createProductWorkflowKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    entities: [],
    relations: [],
    markdown: [
      "# Product Knowledge Graph",
      "",
      "> 当前文件由 Executor Agent 按任务逐步维护。初始项目为空图谱，后续演化以本文档为上下文。",
      "",
      "## Graph Updates",
      "",
    ].join("\n"),
    notes: ["MVP placeholder: 产品设计知识图谱尚未接入正式存储。"],
  };
}

/**
 * 将 Executor 产出的 markdown patch 追加到产品知识图谱文件。
 */
export function appendKnowledgeGraphPatch({
  markdown,
  taskId,
  agentType,
  patch,
}: {
  markdown: string;
  taskId: string;
  agentType: string;
  patch: string;
}): string {
  const normalized = patch.trim() || "- 本轮未产生有效图谱补丁。";
  return [
    markdown.trimEnd(),
    "",
    `## ${taskId} · ${agentType}`,
    "",
    normalized,
    "",
  ].join("\n");
}

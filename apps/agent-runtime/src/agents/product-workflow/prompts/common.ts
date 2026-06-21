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
 * Executor Agent 的固定职责定义。
 */
export const EXECUTOR_DEFINITIONS = [
  {
    agentType: "product_strategy",
    name: "Product Strategy Agent",
    displayName: "Product Strategy Agent",
    focusLayer: "Goal",
    role: "Build the goal layer by deriving strategic product goals from the user's original pain points.",
  },
  {
    agentType: "user_insight",
    name: "User Insight Agent",
    displayName: "User Insight Agent",
    focusLayer: "Requirement",
    role: "Build the requirement and evidence layers by decomposing user pain points into structured requirements and supporting evidence.",
  },
  {
    agentType: "solution_decision",
    name: "Solution Decision Agent",
    displayName: "Solution Decision Agent",
    focusLayer: "Decision",
    role: "Build the decision layer by proposing options for each requirement and selecting the current recommended decision.",
  },
  {
    agentType: "feature_arch",
    name: "Feature Architecture Agent",
    displayName: "Feature Architecture Agent",
    focusLayer: "Feature",
    role: "Build the feature layer by turning decisions into deliverable feature modules and traceability links.",
  },
  {
    agentType: "tech_design",
    name: "Technical Design Agent",
    displayName: "Technical Design Agent",
    focusLayer: "Component",
    role: "Build the component layer by defining implementation components and design elements for each feature module.",
  },
  {
    agentType: "data_ops",
    name: "Data Operations Agent",
    displayName: "Data Operations Agent",
    focusLayer: "Metric",
    role: "Build the metric layer by defining measurable indicators for goals and core requirements.",
  },
] as const;

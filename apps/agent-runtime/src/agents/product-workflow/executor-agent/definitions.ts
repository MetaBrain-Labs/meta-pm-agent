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

/**
 * 单个领域 Executor Agent 的职责配置。
 */
export type ExecutorAgentDefinition = (typeof EXECUTOR_DEFINITIONS)[number];

/**
 * 可被 Planner 分配任务的 Executor Agent 类型。
 */
export type ExecutorAgentType = ExecutorAgentDefinition["agentType"];

/**
 * 获取 Executor Agent 的职责定义。
 */
export function getExecutorDefinition(
  agentType: ExecutorAgentType,
): ExecutorAgentDefinition {
  return EXECUTOR_DEFINITIONS.find((item) => item.agentType === agentType)!;
}

import type { ExecutorAgentProfile } from "../types";

/**
 * Marketing Growth Executor 负责增长指标和营销决策图谱建模。
 */
export const marketingGrowthExecutorProfile = {
  agentType: "executor-marketing-growth",
  name: "Marketing Growth Executor",
  displayName: "Marketing Growth Executor",
  domain: "marketing-growth",
  focusLayer: "Metric",
  graphRole: "创建和细化指标、决策、需求实体，建立衡量体系和营销增长决策链路。",
  skillSource: "pm-skills/pm-marketing-growth/",
  referencePath: "references/executor/marketing-growth-executor",
  allowedEntityTypes: ["Metric", "Decision", "Requirement"],
  allowedRelationTypes: ["Measures", "Composes", "Drives", "Produces"],
  skills: [
    "north-star-metric",
    "value-prop-statements",
    "positioning-ideas",
    "product-name",
    "marketing-ideas",
  ],
  executionGuidelines: [
    "将北极星指标、输入指标和增长 KPI 转成 Metric 节点，并用 Measures 连接 Goal 或 Requirement。",
    "将价值主张、定位和营销想法转成 Decision 节点。",
    "从价值主张背后提炼 Requirement，并用 Drives 连接增长 Decision。",
    "不输出营销文案成品，只记录可追踪的指标、决策和需求节点。",
  ],
} as const satisfies ExecutorAgentProfile;

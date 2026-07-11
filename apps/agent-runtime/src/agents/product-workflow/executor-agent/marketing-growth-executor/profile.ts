/**
 * Marketing Growth Executor 档案
 *
 * 定义 Marketing Growth Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Metric、Decision、Requirement 实体
 * - 建立衡量体系和营销增长决策链路，定义北极星指标和增长 KPI
 */

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
  graphRole: "Create and refine Metric, Decision, and Requirement entities, establishing measurement systems and marketing-growth decision chains.",
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
    "Convert north-star metrics, input metrics, and growth KPIs into Metric nodes, and connect them to Goal or Requirement nodes with Measures relations.",
    "Convert value propositions, positioning, and marketing ideas into Decision nodes.",
    "Extract Requirement nodes behind value propositions; connect an existing Goal to each growth Decision with Drives, then connect the Decision to its Requirement with Produces.",
    "Do not output finished marketing copy; only record traceable Metric, Decision, and Requirement nodes.",
  ],
} as const satisfies ExecutorAgentProfile;
